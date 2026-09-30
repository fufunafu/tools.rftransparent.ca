package ca.rftransparent.tools;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private TextView privacyShield;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RFNativeSupportPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (getBridge() == null) return;

        // Android 16 enforces edge-to-edge. Keep controls outside system bars
        // and the keyboard, including on devices with display cutouts.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);

        privacyShield = new TextView(this);
        privacyShield.setText("RF Tools");
        privacyShield.setTextColor(Color.WHITE);
        privacyShield.setTextSize(24);
        privacyShield.setGravity(Gravity.CENTER);
        privacyShield.setBackgroundColor(Color.rgb(30, 58, 138));
        privacyShield.setVisibility(View.GONE);
        privacyShield.setClickable(true);
        privacyShield.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        addContentView(privacyShield, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    @Override
    public void onPause() {
        if (privacyShield != null) privacyShield.setVisibility(View.VISIBLE);
        super.onPause();
    }

    public void hidePrivacyShield() {
        // The web runtime calls this after restoring its session gate. Do not
        // reveal employee content on a timer while the WebView is recovering.
        runOnUiThread(() -> {
            if (privacyShield != null) privacyShield.setVisibility(View.GONE);
        });
    }
}
