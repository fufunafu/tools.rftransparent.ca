package ca.rftransparent.tools;

import static org.junit.Assert.*;

import android.view.View;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RecoveryTest {
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

    private void openRecovery(ActivityScenario<MainActivity> scenario) throws Exception {
        scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl(activity.getBridge().getErrorUrl()));
        awaitRecovery(scenario);
    }

    private void awaitRecovery(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = System.currentTimeMillis() + 30000;
        while (System.currentTimeMillis() < deadline) {
            String ready = evaluate(scenario,
                "document.readyState === 'complete' && !!document.getElementById('retry') && !document.getElementById('retry').disabled");
            if ("true".equals(ready)) return;
            Thread.sleep(100);
        }
        fail("Bundled recovery page did not render without a network response");
    }

    @Test
    public void disconnectedStartupShowsBundledRecoveryAndRetryRemainsUsable() throws Exception {
        org.junit.Assume.assumeTrue("Run with the emulator network disabled",
            "true".equals(InstrumentationRegistry.getArguments().getString("offlineStart")));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitRecovery(scenario);
            assertEquals("true", evaluate(scenario, "!document.getElementById('retry').disabled"));
            evaluate(scenario, "document.getElementById('retry').click(); true");
            awaitRecovery(scenario);
            assertEquals("true", evaluate(scenario, "!document.getElementById('retry').disabled"));
            scenario.onActivity(activity -> assertTrue(
                activity.getSharedPreferences("rf-native-diagnostics", 0).getInt("loadFailures", 0) > 0));
        }
    }

    @Test
    public void offlinePageProvidesRecoveryWithoutNativeJavascriptBridge() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            openRecovery(scenario);
            assertEquals("true", evaluate(scenario,
                "document.body.innerText.includes('Your work has not been submitted.') && !document.getElementById('retry').disabled"));
            assertEquals("true", evaluate(scenario,
                "document.documentElement.scrollWidth <= window.innerWidth"));
            TestScreenshots.capture(scenario, "offline");
            scenario.onActivity(activity -> {
                View shield = activity.getWindow().getDecorView().findViewWithTag("rf-privacy-shield");
                assertNotNull(shield);
                assertEquals(View.GONE, shield.getVisibility());
            });
        }
    }

    @Test
    public void offlinePageCanResumeAfterAppSwitcherWithoutWaitingForAPluginCallback() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            openRecovery(scenario);
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.onActivity(activity -> {
                View shield = activity.getWindow().getDecorView().findViewWithTag("rf-privacy-shield");
                assertEquals(View.VISIBLE, shield.getVisibility());
            });
            scenario.moveToState(Lifecycle.State.RESUMED);
            scenario.onActivity(activity -> {
                View shield = activity.getWindow().getDecorView().findViewWithTag("rf-privacy-shield");
                assertEquals(View.GONE, shield.getVisibility());
            });
            assertEquals("true", evaluate(scenario, "!!document.getElementById('retry')"));
        }
    }
}
