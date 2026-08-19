# fancurve

OpenWrt / ImmortalWrt PWM fan controller with a motherboard-style temperature curve.

This feed contains:

- `fancurve` — userspace daemon that interpolates PWM from temperature control points
- `luci-app-fancurve` — LuCI page to drag those points and apply the curve

The daemon writes the standard hwmon `pwmN` interface (`0..255`).

## Add as a feed

In the OpenWrt / ImmortalWrt build root, add this line to `feeds.conf.default`:

```
src-git fancurve https://github.com/billtv/fancurve.git;main
```

Then:

```sh
./scripts/feeds update fancurve
./scripts/feeds install -a -p fancurve
```

Select `fancurve` and `luci-app-fancurve` in `make menuconfig`, then build.

## Packages

| Package | Role |
| --- | --- |
| `fancurve` | `/usr/bin/fancurve`, UCI `/etc/config/fancurve`, init `/etc/init.d/fancurve` |
| `luci-app-fancurve` | LuCI **Services → Fan Curve** |

Existing `fancontrol` UCI is imported once by `/etc/uci-defaults/99-fancurve`.

## License

[GPL-2.0-or-later](LICENSE), the same family of license used by OpenWrt.

This project includes work derived from [JiaY-shi/fancontrol](https://github.com/JiaY-shi/fancontrol) (MIT).
