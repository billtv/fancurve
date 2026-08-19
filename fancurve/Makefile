include $(TOPDIR)/rules.mk

PKG_NAME:=fancurve
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-or-later
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=billtv <https://github.com/billtv/fancurve>

PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/fancurve
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=PWM fan curve controller
  PROVIDES:=fancontrol
endef

define Package/fancurve/description
  Userspace PWM fan controller with a piecewise-linear temperature curve.
endef

define Package/fancurve/conffiles
/etc/config/fancurve
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)
endef

MAKE_FLAGS += \
	-C $(PKG_BUILD_DIR)

define Package/fancurve/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/fancurve $(1)/usr/bin/fancurve
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/fancurve.config $(1)/etc/config/fancurve
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/fancurve.init $(1)/etc/init.d/fancurve
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/fancurve.defaults $(1)/etc/uci-defaults/99-fancurve
endef

$(eval $(call BuildPackage,fancurve))
