// SPDX-License-Identifier: GPL-2.0-or-later

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>

#define MAX_LENGTH 200
#define MAX_TEMP 120
#define MAX_POINTS 8

char thermal_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/thermal_zone0/temp";
char fan_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/cooling_device0/cur_state";

int start_speed = 35;
int start_temp = 45;
int max_speed = 255;
int temp_div = 1000;
int debug_mode = 0;

typedef struct {
	int temp;
	int percent;
} curve_point_t;

static curve_point_t curve[MAX_POINTS];
static int curve_count;

static int read_file(const char *path, char *result, size_t size)
{
	FILE *fp;
	char *line = NULL;
	size_t len = 0;
	ssize_t nread;

	fp = fopen(path, "r");
	if (fp == NULL)
		return -1;

	nread = getline(&line, &len, fp);
	if (nread != -1) {
		if (size != 0)
			memcpy(result, line, size);
		else
			memcpy(result, line, nread - 1);
	}

	fclose(fp);
	free(line);
	return 0;
}

static size_t write_file(const char *path, char *buf, size_t len)
{
	FILE *fp;
	size_t size = 0;

	fp = fopen(path, "w+");
	if (fp == NULL)
		return 0;

	size = fwrite(buf, len, 1, fp);
	fclose(fp);
	return size;
}

static int get_temperature(const char *path, int div)
{
	char buf[8] = { 0 };

	if (div <= 0)
		div = 1;

	if (read_file(path, buf, 0) == 0)
		return atoi(buf) / div;

	return -1;
}

static int get_fanspeed(const char *path)
{
	char buf[8] = { 0 };

	if (read_file(path, buf, 0) == 0)
		return atoi(buf);

	return -1;
}

static int set_fanspeed(int fan_speed, const char *path)
{
	char buf[8] = { 0 };

	snprintf(buf, sizeof(buf), "%d\n", fan_speed);
	return write_file(path, buf, strlen(buf));
}

static int cmp_points(const void *a, const void *b)
{
	const curve_point_t *pa = a;
	const curve_point_t *pb = b;

	return pa->temp - pb->temp;
}

static int parse_curve(const char *input)
{
	char buf[256];
	char *tok;
	int n = 0;
	int i, w;

	if (input == NULL || input[0] == '\0')
		return 0;

	snprintf(buf, sizeof(buf), "%s", input);

	for (tok = strtok(buf, ","); tok != NULL && n < MAX_POINTS; tok = strtok(NULL, ",")) {
		char *colon;
		int t, p;

		while (*tok == ' ' || *tok == '\t')
			tok++;

		colon = strchr(tok, ':');
		if (colon == NULL)
			continue;

		*colon = '\0';
		t = atoi(tok);
		p = atoi(colon + 1);

		if (t < 0)
			t = 0;
		if (t > 150)
			t = 150;
		if (p < 0)
			p = 0;
		if (p > 100)
			p = 100;

		curve[n].temp = t;
		curve[n].percent = p;
		n++;
	}

	if (n < 2)
		return 0;

	qsort(curve, n, sizeof(curve[0]), cmp_points);

	w = 1;
	for (i = 1; i < n; i++) {
		if (curve[i].temp == curve[w - 1].temp)
			curve[w - 1].percent = curve[i].percent;
		else
			curve[w++] = curve[i];
	}

	if (w < 2)
		return 0;

	curve_count = w;
	return 1;
}

static int percent_from_curve(int current_temp)
{
	int i, dt, dp;

	if (curve_count < 2)
		return -1;

	if (current_temp <= curve[0].temp)
		return curve[0].percent;

	if (current_temp >= curve[curve_count - 1].temp)
		return curve[curve_count - 1].percent;

	for (i = 0; i < curve_count - 1; i++) {
		if (current_temp > curve[i + 1].temp)
			continue;

		dt = curve[i + 1].temp - curve[i].temp;
		dp = curve[i + 1].percent - curve[i].percent;
		if (dt <= 0)
			return curve[i].percent;

		return curve[i].percent + (current_temp - curve[i].temp) * dp / dt;
	}

	return curve[curve_count - 1].percent;
}

static int percent_to_pwm(int percent)
{
	if (percent <= 0)
		return 0;
	if (percent >= 100)
		return max_speed;

	return percent * max_speed / 100;
}

static int calculate_speed(int current_temp)
{
	int percent;

	percent = percent_from_curve(current_temp);
	if (percent >= 0)
		return percent_to_pwm(percent);

	if (current_temp < start_temp)
		return 0;

	if (current_temp >= MAX_TEMP)
		return max_speed;

	return (current_temp - start_temp) * (max_speed - start_speed) /
	       (MAX_TEMP - start_temp) + start_speed;
}

static int file_exist(const char *name)
{
	struct stat buffer;

	return stat(name, &buffer);
}

static void handle_termination(int signum)
{
	(void)signum;
	set_fanspeed(0, fan_file);
	exit(EXIT_SUCCESS);
}

static void register_signal_handlers(void)
{
	struct sigaction sa;

	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = handle_termination;
	sigemptyset(&sa.sa_mask);
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
}

static void usage(const char *argv0)
{
	fprintf(stderr,
		"Usage: %s [option]\n"
		"          -T sysfs         # temperature sysfs file, default is '%s'\n"
		"          -F sysfs         # fan sysfs file, default is '%s'\n"
		"          -s speed         # fallback start PWM if no curve, default is %d\n"
		"          -t temperature   # fallback start temperature, default is %d°C\n"
		"          -m speed         # PWM corresponding to 100%%, default is %d\n"
		"          -d div           # temperature divide, default is %d\n"
		"          -c curve         # temp:percent points, e.g. 40:0,55:25,70:50,85:80,100:100\n"
		"          -D mode          # verbose when non-zero\n",
		argv0, thermal_file, fan_file, start_speed, start_temp, max_speed, temp_div);
}

int main(int argc, char *argv[])
{
	int opt;

	while ((opt = getopt(argc, argv, "T:F:s:t:m:d:D:c:")) != -1) {
		switch (opt) {
		case 'T':
			snprintf(thermal_file, sizeof(thermal_file), "%s", optarg);
			break;
		case 'F':
			snprintf(fan_file, sizeof(fan_file), "%s", optarg);
			break;
		case 's':
			start_speed = atoi(optarg);
			break;
		case 't':
			start_temp = atoi(optarg);
			break;
		case 'm':
			max_speed = atoi(optarg);
			break;
		case 'd':
			temp_div = atoi(optarg);
			break;
		case 'D':
			debug_mode = atoi(optarg);
			break;
		case 'c':
			if (!parse_curve(optarg)) {
				fprintf(stderr, "Invalid curve '%s', using fallback linear map\n", optarg);
				curve_count = 0;
			}
			break;
		default:
			usage(argv[0]);
			exit(EXIT_FAILURE);
		}
	}

	if (file_exist(fan_file) != 0 || file_exist(thermal_file) != 0) {
		fprintf(stderr, "File: '%s' or '%s' not exist\n", fan_file, thermal_file);
		exit(EXIT_FAILURE);
	}

	if (max_speed <= 0)
		max_speed = 255;

	register_signal_handlers();

	while (1) {
		int temperature = get_temperature(thermal_file, temp_div);

		if (temperature > 0) {
			int fan_speed = calculate_speed(temperature);

			if (fan_speed < 0)
				fan_speed = 0;
			if (fan_speed > max_speed)
				fan_speed = max_speed;

			set_fanspeed(fan_speed, fan_file);
		}

		if (debug_mode) {
			int percent = percent_from_curve(temperature);

			fprintf(stdout, "Temperature: %d°C, Curve: %d%%, Fan Speed: %d\n",
				temperature, percent, get_fanspeed(fan_file));
		}

		sleep(5);
	}

	return 0;
}
