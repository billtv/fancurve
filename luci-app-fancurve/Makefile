#
# Copyright (C) 2026 billtv <https://github.com/billtv/fancurve>
#
# This is free software, licensed under the GNU General Public License v2
# or later. See LICENSE for more information.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Fan Curve
LUCI_DESCRIPTION:=Motherboard-style PWM fan curve editor for fancurve.
LUCI_DEPENDS:=+luci +fancurve
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-fancurve
PKG_VERSION:=1.3
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-or-later
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=billtv <https://github.com/billtv/fancurve>
PKG_PROVIDES:=luci-app-fancontrol

include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage - OpenWrt buildroot signature
