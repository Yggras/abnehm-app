package expo.modules.hcfeature

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Feature-Check für Hintergrund-Lesen, den react-native-health-connect nicht anbietet.
// https://developer.android.com/health-and-fitness/health-connect/features/availability
class HcFeatureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HcFeature")

    Function("backgroundReadStatus") {
      val context = appContext.reactContext ?: return@Function "kein Kontext"
      if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
        return@Function "Health Connect nicht verfügbar"
      }
      val status = HealthConnectClient.getOrCreate(context)
        .features
        .getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)
      when (status) {
        HealthConnectFeatures.FEATURE_STATUS_AVAILABLE -> "verfügbar"
        HealthConnectFeatures.FEATURE_STATUS_UNAVAILABLE -> "nicht verfügbar"
        else -> "unbekannt ($status)"
      }
    }
  }
}
