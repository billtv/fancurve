'use strict';
'require view';
'require fs';
'require form';
'require uci';
'require poll';
'require ui';

const TEMP_MIN = 20;
const TEMP_MAX = 120;
const MIN_POINTS = 2;
const MAX_POINTS = 8;
const MIN_GAP = 2;
const DEFAULT_CURVE = '40:0,55:25,70:50,85:80,100:100';

function parseCurve(text) {
	const points = [];

	String(text || '').split(',').forEach(function(pair) {
		const parts = pair.split(':');
		const temp = parseInt(parts[0], 10);
		const percent = parseInt(parts[1], 10);

		if (parts.length === 2 && !isNaN(temp) && !isNaN(percent))
			points.push({
				temp: Math.max(0, Math.min(150, temp)),
				percent: Math.max(0, Math.min(100, percent))
			});
	});

	points.sort(function(a, b) { return a.temp - b.temp; });

	const unique = [];
	points.forEach(function(point) {
		if (unique.length && unique[unique.length - 1].temp === point.temp)
			unique[unique.length - 1] = point;
		else
			unique.push(point);
	});

	return unique;
}

function formatCurve(points) {
	return points.map(function(point) {
		return '%d:%d'.format(point.temp, point.percent);
	}).join(',');
}

function interpolatePercent(points, temp) {
	let i, dt, dp;

	if (!points.length)
		return 0;

	if (temp <= points[0].temp)
		return points[0].percent;

	if (temp >= points[points.length - 1].temp)
		return points[points.length - 1].percent;

	for (i = 0; i < points.length - 1; i++) {
		if (temp > points[i + 1].temp)
			continue;

		dt = points[i + 1].temp - points[i].temp;
		dp = points[i + 1].percent - points[i].percent;
		if (dt <= 0)
			return points[i].percent;

		return points[i].percent + (temp - points[i].temp) * dp / dt;
	}

	return points[points.length - 1].percent;
}

function clampPoint(points, index, temp, percent) {
	const minTemp = index === 0 ? 0 : points[index - 1].temp + MIN_GAP;
	const maxTemp = index === points.length - 1 ? 150 : points[index + 1].temp - MIN_GAP;

	points[index].temp = Math.max(minTemp, Math.min(maxTemp, Math.round(temp)));
	points[index].percent = Math.max(0, Math.min(100, Math.round(percent)));
}

function legacyCurve() {
	const startTemp = parseInt(uci.get('fancurve', 'settings', 'start_temp'), 10);
	const startSpeed = parseInt(uci.get('fancurve', 'settings', 'start_speed'), 10);
	const maxSpeed = parseInt(uci.get('fancurve', 'settings', 'max_speed'), 10) || 255;
	const t = isNaN(startTemp) ? 45 : startTemp;
	const pct = isNaN(startSpeed) ? 14 : Math.max(0, Math.min(100, Math.round(startSpeed * 100 / maxSpeed)));

	return formatCurve([
		{ temp: Math.max(0, t - MIN_GAP), percent: 0 },
		{ temp: t, percent: pct },
		{ temp: 120, percent: 100 }
	]);
}

function addPoint(points) {
	let gap = -1;
	let insertAt = -1;
	let i, dt, midTemp, midPercent;

	if (points.length >= MAX_POINTS)
		return false;

	for (i = 0; i < points.length - 1; i++) {
		dt = points[i + 1].temp - points[i].temp;
		if (dt > gap && dt >= MIN_GAP * 2) {
			gap = dt;
			insertAt = i + 1;
		}
	}

	if (insertAt < 0)
		return false;

	midTemp = Math.round((points[insertAt - 1].temp + points[insertAt].temp) / 2);
	midPercent = Math.round(interpolatePercent(points, midTemp));
	points.splice(insertAt, 0, { temp: midTemp, percent: midPercent });
	return true;
}

var FanCurveEditor = form.Value.extend({
	__name__: 'CBI.FanCurveEditor',

	formvalue: function(section_id) {
		const elem = this.getUIElement(section_id);
		if (elem)
			return elem.getValue();

		const node = this.map.findElement('id', this.cbid(section_id));
		return node ? node.value : null;
	},

	renderWidget: function(section_id, option_index, cfgvalue) {
		const self = this;
		const id = this.cbid(section_id);
		const points = parseCurve(String(cfgvalue || '').trim() ? cfgvalue : legacyCurve());
		let selected = 0;
		let dragging = -1;
		let liveTemp = null;
		let livePwm = null;
		let maxSpeed = parseInt(uci.get('fancurve', 'settings', 'max_speed'), 10) || 255;

		if (points.length < MIN_POINTS) {
			points.length = 0;
			parseCurve(DEFAULT_CURVE).forEach(function(point) { points.push(point); });
		}

		const style = E('style', {}, [
			'.fancurve{margin:.25em 0}',
			'.fancurve-canvas{width:100%;height:280px;display:block;border:1px solid var(--border-color-medium,#d0d0d0);border-radius:10px;background:var(--background-color-high,#fff);touch-action:none;cursor:crosshair}',
			'.fancurve-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}',
			'.fancurve-status{font-size:12px;color:var(--text-color-medium,#666);margin:4px 0 10px}',
			'.fancurve-points{display:flex;flex-wrap:wrap;gap:8px}',
			'.fancurve-point{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border-color-low,#ddd);border-radius:8px;background:rgba(127,127,127,.05)}',
			'.fancurve-point.selected{border-color:#31ba80;background:rgba(49,186,128,.1)}',
			'.fancurve-point label{font-size:11px;color:var(--text-color-medium,#777)}',
			'.fancurve-point input{width:4.2em}',
			'.fancurve-note{margin-top:8px;font-size:12px;color:var(--text-color-medium,#666)}'
		].join(''));

		const canvas = E('canvas', { 'class': 'fancurve-canvas' });
		const hiddenWidget = new ui.Hiddenfield(formatCurve(points), {
			id: id,
			name: id
		});
		const hidden = hiddenWidget.render();
		const status = E('div', { 'class': 'fancurve-status' });
		const table = E('div', { 'class': 'fancurve-points' });

		function commit() {
			hiddenWidget.setValue(formatCurve(points));
			draw();
			renderTable();
			updateStatus();
		}

		function layout() {
			const width = Math.max(canvas.clientWidth, 1);
			const height = Math.max(canvas.clientHeight, 1);
			const left = 42;
			const top = 18;
			const right = 18;
			const bottom = 30;

			return {
				width: width,
				height: height,
				left: left,
				top: top,
				plotW: Math.max(width - left - right, 1),
				plotH: Math.max(height - top - bottom, 1)
			};
		}

		function xOf(box, temp) {
			return box.left + (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN) * box.plotW;
		}

		function yOf(box, percent) {
			return box.top + (100 - percent) * box.plotH / 100;
		}

		function tempOf(box, x) {
			return TEMP_MIN + (x - box.left) / box.plotW * (TEMP_MAX - TEMP_MIN);
		}

		function percentOf(box, y) {
			return 100 - (y - box.top) / box.plotH * 100;
		}

		function hitTest(box, x, y) {
			let best = -1;
			let bestDist = 14;
			let i, dx, dy, dist;

			for (i = 0; i < points.length; i++) {
				dx = xOf(box, points[i].temp) - x;
				dy = yOf(box, points[i].percent) - y;
				dist = Math.sqrt(dx * dx + dy * dy);
				if (dist <= bestDist) {
					best = i;
					bestDist = dist;
				}
			}

			return best;
		}

		function draw() {
			const box = layout();
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const ctx = canvas.getContext('2d');
			const styleMap = window.getComputedStyle(canvas);
			const textColor = styleMap.color || '#666';
			const lineColor = '#31ba80';
			let i, t, markerX, markerY, markerText, markerWidth, markerLeft, livePercent;

			canvas.width = Math.round(box.width * ratio);
			canvas.height = Math.round(box.height * ratio);
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			ctx.clearRect(0, 0, box.width, box.height);

			ctx.fillStyle = styleMap.backgroundColor || '#fff';
			ctx.fillRect(0, 0, box.width, box.height);

			ctx.strokeStyle = 'rgba(127,127,127,.18)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (t = 40; t <= 100; t += 20) {
				ctx.moveTo(xOf(box, t), box.top);
				ctx.lineTo(xOf(box, t), box.top + box.plotH);
			}
			[25, 50, 75].forEach(function(level) {
				ctx.moveTo(box.left, yOf(box, level));
				ctx.lineTo(box.left + box.plotW, yOf(box, level));
			});
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(xOf(box, points[0].temp), box.top + box.plotH);
			points.forEach(function(point) {
				ctx.lineTo(xOf(box, point.temp), yOf(box, point.percent));
			});
			ctx.lineTo(xOf(box, points[points.length - 1].temp), box.top + box.plotH);
			ctx.closePath();
			ctx.fillStyle = 'rgba(49,186,128,.16)';
			ctx.fill();

			ctx.beginPath();
			points.forEach(function(point, index) {
				if (index)
					ctx.lineTo(xOf(box, point.temp), yOf(box, point.percent));
				else
					ctx.moveTo(xOf(box, point.temp), yOf(box, point.percent));
			});
			ctx.strokeStyle = lineColor;
			ctx.lineWidth = 2.5;
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.stroke();

			points.forEach(function(point, index) {
				ctx.beginPath();
				ctx.arc(xOf(box, point.temp), yOf(box, point.percent), index === selected ? 7 : 5.5, 0, Math.PI * 2);
				ctx.fillStyle = index === selected ? lineColor : '#fff';
				ctx.fill();
				ctx.strokeStyle = lineColor;
				ctx.lineWidth = 2;
				ctx.stroke();
			});

			if (liveTemp != null) {
				livePercent = interpolatePercent(points, liveTemp);
				markerX = xOf(box, Math.max(TEMP_MIN, Math.min(TEMP_MAX, liveTemp)));
				markerY = yOf(box, livePercent);
				markerText = '%.0f°C · %d%%'.format(liveTemp, Math.round(livePercent));
				ctx.font = '600 11px sans-serif';
				markerWidth = ctx.measureText(markerText).width + 16;
				markerLeft = Math.max(8, Math.min(box.width - markerWidth - 8, markerX - markerWidth / 2));
				ctx.fillStyle = '#24342d';
				ctx.fillRect(markerLeft, Math.max(6, markerY - 28), markerWidth, 20);
				ctx.fillStyle = '#fff';
				ctx.textBaseline = 'middle';
				ctx.fillText(markerText, markerLeft + 8, Math.max(6, markerY - 28) + 10);
				ctx.beginPath();
				ctx.moveTo(markerX, box.top);
				ctx.lineTo(markerX, box.top + box.plotH);
				ctx.strokeStyle = 'rgba(36,52,45,.35)';
				ctx.setLineDash([4, 4]);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.beginPath();
				ctx.arc(markerX, markerY, 4, 0, Math.PI * 2);
				ctx.fillStyle = '#24342d';
				ctx.fill();
			}

			ctx.fillStyle = textColor;
			ctx.font = '11px sans-serif';
			ctx.textBaseline = 'top';
			ctx.textAlign = 'center';
			[20, 40, 60, 80, 100, 120].forEach(function(label) {
				ctx.fillText(label + '°C', xOf(box, label), box.top + box.plotH + 8);
			});
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			[0, 50, 100].forEach(function(label) {
				ctx.fillText(label + '%', box.left - 6, yOf(box, label));
			});
		}

		function renderTable() {
			const children = points.map(function(point, index) {
				const tempInput = E('input', {
					type: 'number',
					min: '0',
					max: '150',
					step: '1',
					value: point.temp
				});
				const percentInput = E('input', {
					type: 'number',
					min: '0',
					max: '100',
					step: '1',
					value: point.percent
				});

				tempInput.addEventListener('change', function() {
					selected = index;
					clampPoint(points, index, parseInt(tempInput.value, 10) || 0, points[index].percent);
					commit();
				});
				percentInput.addEventListener('change', function() {
					selected = index;
					clampPoint(points, index, points[index].temp, parseInt(percentInput.value, 10) || 0);
					commit();
				});

				return E('div', {
					'class': 'fancurve-point' + (index === selected ? ' selected' : ''),
					click: function() {
						selected = index;
						renderTable();
						draw();
					}
				}, [
					E('label', {}, _('Point %d').format(index + 1)),
					tempInput,
					E('span', {}, '°C'),
					percentInput,
					E('span', {}, '%')
				]);
			});

			table.replaceChildren.apply(table, children);
		}

		function updateStatus() {
			const percent = liveTemp == null ? null : interpolatePercent(points, liveTemp);
			const targetPwm = percent == null ? null : Math.round(percent * maxSpeed / 100);
			const parts = [];

			if (liveTemp != null)
				parts.push(_('Current temperature: %s °C').format('%.1f'.format(liveTemp)));
			if (percent != null)
				parts.push(_('Curve target: %s%%').format(Math.round(percent)));
			if (targetPwm != null)
				parts.push(_('Target PWM: %s').format(targetPwm));
			if (livePwm != null)
				parts.push(_('Actual PWM: %s').format(livePwm));

			status.textContent = parts.length ?
				parts.join(' · ') :
				_('Drag the points, then click Save & Apply.');
		}

		function pointerPos(ev) {
			const rect = canvas.getBoundingClientRect();

			return {
				x: ev.clientX - rect.left,
				y: ev.clientY - rect.top
			};
		}

		canvas.addEventListener('pointerdown', function(ev) {
			const box = layout();
			const pos = pointerPos(ev);
			const hit = hitTest(box, pos.x, pos.y);

			if (hit < 0)
				return;

			dragging = hit;
			selected = hit;
			canvas.setPointerCapture(ev.pointerId);
			commit();
			ev.preventDefault();
		});

		canvas.addEventListener('pointermove', function(ev) {
			const box = layout();
			const pos = pointerPos(ev);

			if (dragging < 0) {
				canvas.style.cursor = hitTest(box, pos.x, pos.y) >= 0 ? 'grab' : 'crosshair';
				return;
			}

			clampPoint(points, dragging, tempOf(box, pos.x), percentOf(box, pos.y));
			canvas.style.cursor = 'grabbing';
			commit();
		});

		canvas.addEventListener('pointerup', function() {
			dragging = -1;
		});

		window.addEventListener('resize', draw);

		const addBtn = E('button', { type: 'button', 'class': 'btn' }, _('Add point'));
		const removeBtn = E('button', { type: 'button', 'class': 'btn' }, _('Remove point'));
		const resetBtn = E('button', { type: 'button', 'class': 'btn' }, _('Restore default'));

		addBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!addPoint(points)) {
				ui.addNotification(null, E('p', _('At most 8 control points can be used.')), 'warning');
				return;
			}
			selected = Math.min(selected + 1, points.length - 1);
			commit();
		});

		removeBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (points.length <= MIN_POINTS) {
				ui.addNotification(null, E('p', _('At least two control points are required.')), 'warning');
				return;
			}
			points.splice(selected >= 0 ? selected : points.length - 1, 1);
			selected = Math.max(0, Math.min(selected, points.length - 1));
			commit();
		});

		resetBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			points.splice(0, points.length);
			parseCurve(DEFAULT_CURVE).forEach(function(point) { points.push(point); });
			selected = 0;
			commit();
		});

		self._setLive = function(temp, pwm, pwmMax) {
			liveTemp = temp;
			livePwm = pwm;
			if (pwmMax > 0)
				maxSpeed = pwmMax;
			draw();
			updateStatus();
		};

		requestAnimationFrame(commit);

		return E('div', { 'class': 'fancurve' }, [
			style,
			canvas,
			E('div', { 'class': 'fancurve-toolbar' }, [ addBtn, removeBtn, resetBtn ]),
			status,
			table,
			E('div', { 'class': 'fancurve-note' },
				_('Horizontal axis is temperature, vertical axis is fan duty. Adjacent points are connected with straight lines, same as a motherboard fan curve. Click Save & Apply to write the curve to the controller.')),
			hidden
		]);
	}
});

return view.extend({
	load: function() {
		return uci.load('fancurve');
	},

	readSysfsNumber: function(path) {
		if (!path)
			return Promise.resolve(null);

		return fs.read(path).then(function(text) {
			const value = parseInt(text, 10);
			return isNaN(value) ? null : value;
		}).catch(function() {
			return null;
		});
	},

	render: function() {
		const self = this;
		let m, s, o;
		let curveOption;

		m = new form.Map('fancurve', _('Fan Curve'),
			_('Set a motherboard-style fan curve by dragging control points. Fan duty is interpolated between the points.'));

		s = m.section(form.TypedSection, 'fancurve', _('Settings'));
		s.anonymous = true;
		s.addremove = false;
		s.tab('curve', _('Fan Curve'));
		s.tab('hardware', _('Hardware'));

		o = s.taboption('curve', form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;
		o.description = _('Run the controller with the curve below.');

		curveOption = s.taboption('curve', FanCurveEditor, 'curve', _('Temperature / speed curve'));
		curveOption.rmempty = false;
		curveOption.default = DEFAULT_CURVE;
		curveOption.validate = function(section_id, value) {
			const points = parseCurve(value);
			let i;

			if (points.length < MIN_POINTS || formatCurve(points) !== String(value || '').replace(/\s+/g, ''))
				return _('Use 2 to 8 points as temperature:percent, for example 40:0,55:25,70:50,85:80,100:100.');

			for (i = 1; i < points.length; i++) {
				if (points[i].temp < points[i - 1].temp + MIN_GAP)
					return _('Temperatures must increase by at least 2 °C between points.');
			}

			return true;
		};

		o = s.taboption('hardware', form.Value, 'thermal_file', _('Thermal File'));
		o.rmempty = false;

		o = s.taboption('hardware', form.Value, 'fan_file', _('Fan File'));
		o.rmempty = false;

		o = s.taboption('hardware', form.Value, 'max_speed', _('Max Speed'));
		o.datatype = 'range(1,255)';
		o.placeholder = '255';
		o.rmempty = false;
		o.description = _('PWM value that corresponds to 100% on the curve.');

		o = s.taboption('hardware', form.Value, 'temp_div', _('Temperature divisor'));
		o.value('1');
		o.value('1000');
		o.default = '1000';
		o.datatype = 'range(1,1000000)';
		o.rmempty = false;
		o.description = _('Linux thermal sysfs is usually millidegrees, so 1000. Use 1 if the sensor already reports °C.');

		m.handleSaveApply = function(ev, mode) {
			return form.Map.prototype.handleSaveApply.apply(this, [ ev, mode ]).then(function() {
				return fs.exec('/etc/init.d/fancurve', [ 'restart' ]);
			}).then(function() {
				ui.addNotification(null, E('p', _('Fan curve applied.')));
			}, function(err) {
				ui.addNotification(null, E('p', _('Failed to apply fan curve: %s').format(err.message)), 'danger');
			});
		};

		return m.render().then(function(node) {
			poll.add(function() {
				const thermal = uci.get('fancurve', 'settings', 'thermal_file');
				const fan = uci.get('fancurve', 'settings', 'fan_file');
				const div = parseInt(uci.get('fancurve', 'settings', 'temp_div'), 10) || 1000;
				const maxSpeed = parseInt(uci.get('fancurve', 'settings', 'max_speed'), 10) || 255;

				return Promise.all([
					self.readSysfsNumber(thermal),
					self.readSysfsNumber(fan)
				]).then(function(values) {
					if (curveOption._setLive)
						curveOption._setLive(values[0] != null ? values[0] / div : null, values[1], maxSpeed);
				});
			}, 5);

			return node;
		});
	}
});
