// TX2 legacy sysfs GPIO helper. Node invokes this binary through execFile().
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <cstdlib>
#include <fcntl.h>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

static std::string root;
static std::string gpioPath(int pin, const std::string &name) {
    return root + "/gpio" + std::to_string(pin) + "/" + name;
}
static void writeFile(const std::string &file, const std::string &value) {
    int fd = open(file.c_str(), O_WRONLY); // Never create files in the sysfs tree.
    if (fd < 0) throw std::runtime_error(file + ": " + std::strerror(errno));
    ssize_t written;
    do { written = write(fd, value.c_str(), value.size()); } while (written < 0 && errno == EINTR);
    int error = errno;
    int closed = close(fd);
    if (written != static_cast<ssize_t>(value.size()))
        throw std::runtime_error(file + ": " + (written < 0 ? std::strerror(error) : "short write"));
    if (closed != 0) throw std::runtime_error(file + ": close failed");
}
static std::vector<int> parsePins(const std::string &text) {
    if (text.empty() || text.back() == ',') throw std::runtime_error("Invalid GPIO list");
    std::vector<int> pins;
    std::istringstream input(text);
    std::string part;
    while (std::getline(input, part, ',')) {
        if (part.empty() || part.size() > 6 || part.find_first_not_of("0123456789") != std::string::npos)
            throw std::runtime_error("GPIO must be a non-negative integer");
        pins.push_back(std::stoi(part));
    }
    if (pins.empty() || pins.size() > 4 || std::set<int>(pins.begin(), pins.end()).size() != pins.size())
        throw std::runtime_error("GPIO list must contain 1-4 distinct pins");
    return pins;
}
static void release(const std::vector<int> &pins) {
    std::string errors;
    for (int pin : pins) {
        try { writeFile(root + "/unexport", std::to_string(pin)); }
        catch (const std::exception &err) { errors += std::string(err.what()) + "\n"; }
    }
    if (!errors.empty()) throw std::runtime_error(errors);
}
static void setValues(const std::vector<int> &pins, const std::string &bits) {
    // Turn outgoing LEDs off before turning incoming ones on. Sysfs writes are sequential.
    for (char level : {'0', '1'}) {
        std::string errors;
        for (size_t i = 0; i < pins.size(); ++i)
            if (bits[i] == level) {
                try { writeFile(gpioPath(pins[i], "value"), std::string(1, level)); }
                catch (const std::exception &err) { errors += std::string(err.what()) + "\n"; }
            }
        // Try every OFF even when one pin fails; never start ON after an OFF failure.
        if (!errors.empty()) throw std::runtime_error(errors);
    }
}
int main(int argc, char **argv) {
    try {
        if (argc < 3) throw std::runtime_error("Usage: gpio init PINS | set PINS 0101 | release OWNED_PINS");
        root = std::getenv("GPIO_SYSFS_ROOT") ? std::getenv("GPIO_SYSFS_ROOT") : "/sys/class/gpio";
        const std::string action = argv[1];
        const std::vector<int> pins = parsePins(argv[2]);
        if (action == "set") {
            if (argc != 4 || pins.size() != 4) throw std::runtime_error("set requires four pins and four bits");
            const std::string bits = argv[3];
            if (bits.size() != 4 || bits.find_first_not_of("01") != std::string::npos)
                throw std::runtime_error("State must be four bits, LED1 to LED4");
            setValues(pins, bits);
        } else if (action == "init") {
            if (argc != 3 || pins.size() != 4) throw std::runtime_error("init requires four pins");
            std::vector<int> owned, prepared;
            try {
                for (int pin : pins) {
                    if (access(gpioPath(pin, "direction").c_str(), F_OK) != 0) {
                        writeFile(root + "/export", std::to_string(pin));
                        owned.push_back(pin);
                        for (int wait = 0; wait < 50 && access(gpioPath(pin, "direction").c_str(), F_OK) != 0; ++wait)
                            std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    }
                    prepared.push_back(pin);
                    writeFile(gpioPath(pin, "direction"), "low");
                    writeFile(gpioPath(pin, "value"), "0");
                }
            } catch (...) {
                for (int pin : prepared) { try { writeFile(gpioPath(pin, "value"), "0"); } catch (...) {} }
                try { release(owned); } catch (...) {}
                throw;
            }
            std::cout << "{\"owned\":[";
            for (size_t i = 0; i < owned.size(); ++i) std::cout << (i ? "," : "") << owned[i];
            std::cout << "]}\n";
        } else if (action == "release") {
            if (argc != 3) throw std::runtime_error("release takes only a GPIO list");
            release(pins);
        } else throw std::runtime_error("Unknown GPIO operation");
        return 0;
    } catch (const std::exception &err) {
        std::cerr << err.what() << '\n';
        return 1;
    }
}
