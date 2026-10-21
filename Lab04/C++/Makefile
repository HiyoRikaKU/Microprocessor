CXX ?= g++
CXXFLAGS ?= -std=c++11 -O2 -Wall -Wextra -pedantic

gpio: gpio.cpp
	$(CXX) $(CXXFLAGS) gpio.cpp -o gpio

.PHONY: clean
clean:
	rm -f gpio
