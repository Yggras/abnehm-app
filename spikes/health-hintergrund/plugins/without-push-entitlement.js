const { withEntitlementsPlist } = require('expo/config-plugins');

// Der Spike nutzt nur lokale Mitteilungen. expo-notifications setzt trotzdem
// aps-environment; Push gibt es mit kostenlosem Apple-Konto (Personal Team)
// nicht, das Signieren schlüge fehl. Deshalb hier wieder entfernen.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
