package ca.rftransparent.tools;

import static org.junit.Assert.*;

import android.view.WindowManager;
import android.content.Context;
import android.view.inputmethod.InputMethodManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeBridgeTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch response = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            response.countDown();
        }));
        assertTrue("WebView callback must return", response.await(5, TimeUnit.SECONDS));
        return value.get();
    }

    private void awaitBridge(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = System.currentTimeMillis() + 30000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(scenario,
                "document.readyState === 'complete' && !!window.Capacitor?.nativePromise"))) return;
            Thread.sleep(100);
        }
        fail("Hosted app did not load its Android bridge");
    }

    private JSONObject pluginCall(ActivityScenario<MainActivity> scenario, String plugin, String method) throws Exception {
        evaluate(scenario, "window.__rfNativeTest = null; window.Capacitor.nativePromise('" + plugin + "','" + method + "',{})"
            + ".then(value => window.__rfNativeTest = {value}).catch(error => window.__rfNativeTest = {error: String(error)}); true");
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            String response = evaluate(scenario, "window.__rfNativeTest");
            if (!"null".equals(response)) {
                JSONObject result = new JSONObject(response);
                assertFalse("Native call rejected: " + result, result.has("error"));
                return result.getJSONObject("value");
            }
            Thread.sleep(100);
        }
        throw new AssertionError(plugin + "." + method + " did not return");
    }

    @Test
    public void deviceCredentialReturnsThroughNativeBridge() throws Exception {
        org.junit.Assume.assumeTrue("Requires an emulator test PIN",
            "true".equals(InstrumentationRegistry.getArguments().getString("credentialTest")));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitBridge(scenario);
            assertTrue(pluginCall(scenario, "BiometricAuthNative", "checkBiometry").getBoolean("deviceIsSecure"));
            evaluate(scenario, "window.__rfAuthEvents = []; window.Capacitor.nativeCallback('App','addListener',{eventName:'appStateChange'},event => window.__rfAuthEvents.push(event)); true");
            evaluate(scenario, "window.__rfAuthResult = null; window.Capacitor.nativePromise('BiometricAuthNative','internalAuthenticate', {allowDeviceCredential:true,reason:'RF Tools emulator test',androidTitle:'Unlock RF Tools'})"
                + ".then(() => window.__rfAuthResult = 'success').catch(error => window.__rfAuthResult = String(error)); true");
            long deadline = System.currentTimeMillis() + 45000;
            String result = "null";
            while (System.currentTimeMillis() < deadline) {
                result = evaluate(scenario, "window.__rfAuthResult");
                if (!"null".equals(result)) break;
                Thread.sleep(100);
            }
            System.out.println("Credential lifecycle: " + evaluate(scenario, "window.__rfAuthEvents"));
            assertEquals("Native device-credential callback must return success", "\"success\"", result);
        }
    }

    @Test
    public void loginKeyboardLeavesTheFocusedFieldVisible() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitBridge(scenario);
            long deadline = System.currentTimeMillis() + 10000;
            while (!"true".equals(evaluate(scenario, "!!document.querySelector('input[type=email]')"))
                    && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertEquals("true", evaluate(scenario, "!!document.querySelector('input[type=email]')"));
            int originalHeight = Integer.parseInt(evaluate(scenario, "window.innerHeight"));
            evaluate(scenario, "document.querySelector('input[type=email]').focus(); true");
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().requestFocus();
                ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE))
                    .showSoftInput(activity.getBridge().getWebView(), InputMethodManager.SHOW_IMPLICIT);
            });
            deadline = System.currentTimeMillis() + 10000;
            while (Integer.parseInt(evaluate(scenario, "window.innerHeight")) >= originalHeight
                    && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertTrue("The keyboard must resize the WebView", Integer.parseInt(evaluate(scenario, "window.innerHeight")) < originalHeight);
            evaluate(scenario, "document.activeElement.scrollIntoView({block:'center'}); true");
            boolean fieldVisible = false;
            deadline = System.currentTimeMillis() + 5000;
            while (System.currentTimeMillis() < deadline) {
                fieldVisible = "true".equals(evaluate(scenario,
                    "document.activeElement.getBoundingClientRect().bottom <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth"));
                if (fieldVisible) break;
                Thread.sleep(50);
            }
            assertTrue("The focused field must remain above the keyboard", fieldVisible);
            TestScreenshots.capture(scenario, "keyboard");
            scenario.onActivity(activity -> ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(activity.getBridge().getWebView().getWindowToken(), 0));
        }
    }

    @Test
    public void hostedAppLoadsNativePluginsAndKeepsAndroidIdentity() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitBridge(scenario);
            assertEquals("\"android\"", evaluate(scenario, "window.Capacitor.getPlatform()"));
            JSONObject info = pluginCall(scenario, "App", "getInfo");
            assertEquals("ca.rftransparent.tools", info.getString("id"));
            JSONObject device = pluginCall(scenario, "RFNativeSupport", "getDeviceInfo");
            assertTrue(device.getString("operatingSystem").startsWith("Android "));
            assertTrue("Android must not register an APNs token", device.isNull("pushEnvironment"));
            assertTrue(pluginCall(scenario, "RFNativeSupport", "getLocationAuthorizationStatus").has("status"));
            assertTrue(pluginCall(scenario, "BiometricAuthNative", "checkBiometry").has("isAvailable"));
            assertEquals("true", evaluate(scenario, "document.documentElement.scrollWidth <= window.innerWidth"));
            TestScreenshots.capture(scenario, "hosted");
            scenario.onActivity(activity -> assertTrue("Sensitive screens must be protected in app switcher",
                (activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0));
        }
    }
}
