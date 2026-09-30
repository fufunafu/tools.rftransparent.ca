package ca.rftransparent.tools;

import android.Manifest;
import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

@CapacitorPlugin(name = "RFNativeSupport", permissions = {
    @Permission(alias = "location", strings = {
        Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION
    })
})
public class RFNativeSupportPlugin extends Plugin {
    private static final String PRODUCTION_URL = "https://tools.rftransparent.ca";

    private SharedPreferences diagnostics() {
        return getContext().getSharedPreferences("rf-native-diagnostics", 0);
    }

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("operatingSystem", "Android " + Build.VERSION.RELEASE);
        result.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("locale", Locale.getDefault().toLanguageTag());
        // An APNs environment must never be returned for an Android device.
        // The hosted app treats null as push unavailable until FCM is wired up.
        result.put("pushEnvironment", JSONObject.NULL);
        result.put("webViewLoadFailureCount", diagnostics().getInt("loadFailures", 0));
        String lastFailure = diagnostics().getString("lastLoadFailure", null);
        result.put("lastWebViewLoadFailureAt", lastFailure == null ? JSONObject.NULL : lastFailure);
        call.resolve(result);
    }

    @PluginMethod
    public void getLocationAuthorizationStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", getPermissionState("location").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.reject("Device settings could not be opened.");
            }
        });
    }

    @PluginMethod
    public void hidePrivacyShield(PluginCall call) {
        ((MainActivity) getActivity()).hidePrivacyShield();
        call.resolve();
    }

    @PluginMethod
    public void recordWebViewLoadFailure(PluginCall call) {
        recordLoadFailure(getContext());
        call.resolve();
    }

    static void recordLoadFailure(Context context) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        SharedPreferences preferences = context.getSharedPreferences("rf-native-diagnostics", 0);
        preferences.edit()
            .putInt("loadFailures", preferences.getInt("loadFailures", 0) + 1)
            .putString("lastLoadFailure", format.format(new Date()))
            .apply();
    }

    @PluginMethod
    public void retryRemoteLoad(PluginCall call) {
        // Recovery always returns to the first-party app, never a caller URL.
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().loadUrl(PRODUCTION_URL);
            call.resolve();
        });
    }

    @PluginMethod
    public void getServiceStatus(PluginCall call) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(PRODUCTION_URL + "/api/native/status").openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            if (connection.getResponseCode() != 200) throw new IllegalStateException();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (body.size() + count > 65536) throw new IllegalStateException();
                    body.write(buffer, 0, count);
                }
            }
            JSONObject payload = new JSONObject(body.toString("UTF-8"));
            String state = payload.optString("state");
            if (!state.equals("operational") && !state.equals("maintenance")) throw new IllegalStateException();
            JSObject result = new JSObject();
            result.put("state", state);
            result.put("message", payload.opt("message"));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("RF Tools could not check the service status.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
