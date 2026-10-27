package ca.rftransparent.tools;

import android.graphics.Bitmap;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;

final class TestScreenshots {
    static void capture(ActivityScenario<MainActivity> scenario, String name) throws Exception {
        if (!"true".equals(InstrumentationRegistry.getArguments().getString("screenshots"))) return;
        // Only instrumentation may temporarily reveal this unauthenticated test
        // screen for layout QA. Restore the production secure-window flag.
        scenario.onActivity(activity -> activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE));
        try {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Thread.sleep(300);
            Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            if (screenshot == null) throw new AssertionError("Screenshot capture failed");
            File directory = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null), "test-screenshots");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new AssertionError("Screenshot directory failed");
            try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
                if (!screenshot.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new AssertionError("Screenshot save failed");
            }
        } finally {
            scenario.onActivity(activity -> activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE));
        }
    }
}
