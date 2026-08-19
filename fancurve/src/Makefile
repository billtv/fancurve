CC         := gcc
CFLAGS     := -O3 -Wall -fomit-frame-pointer

all: fancurve

fancurve: %: %.o
	$(CC) $(LDFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) $(INCLUDE) -o $@ -c $<

clean:
	rm -f fancurve *.o *~
