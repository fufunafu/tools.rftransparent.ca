package ca.rftransparent.tools;

import android.graphics.Color;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.webkit.WebView;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private TextView privacyShield;
    private final Handler recoveryHandler = new Handler(Looper.getMainLooper());
    private Runnable loadTimeout;
    private boolean recoveryReady;
    private boolean recoveryLoading;

    private boolean isRecoveryPage(String url) {
        return getBridge() != null && getBridge().getErrorUrl() != null &&
            getBridge().getErrorUrl().equals(url);
    }

    private void cancelLoadTimeout() {
        if (loadTimeout != null) recoveryHandler.removeCallbacks(loadTimeout);
        loadTimeout = null;
    }

    void showRecovery(WebView webView) {
        cancelLoadTimeout();
        if (isFinishing() || isDestroyed() || recoveryLoading) return;
        recoveryLoading = true;
        RFNativeSupportPlugin.recordLoadFailure(this);
        webView.stopLoading();
        webView.loadUrl(getBridge().getErrorUrl());
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RFNativeSupportPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (getBridge() == null) return;

        // Android's bundled error page has no Capacitor bridge. Its lifecycle
        // must work natively even when the hosted runtime never loads.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean handledExternally = super.shouldOverrideUrlLoading(view, request);
                if (!handledExternally && request.isForMainFrame() && !isRecoveryPage(request.getUrl().toString())) {
                    // A failed retry can report its error before WebView.getUrl()
                    // changes away from the old error document.
                    recoveryLoading = false;
                    recoveryReady = false;
                }
                return handledExternally;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                cancelLoadTimeout();
                recoveryReady = false;
                recoveryLoading = isRecoveryPage(url);
                if (!recoveryLoading) {
                    loadTimeout = () -> showRecovery(view);
                    recoveryHandler.postDelayed(loadTimeout, 20000);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!url.equals(view.getUrl())) return;
                cancelLoadTimeout();
                if (isRecoveryPage(url)) {
                    recoveryReady = true;
                    configureSystemBarContrast();
                    if (getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
                        hidePrivacyShield();
                    }
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !isRecoveryPage(request.getUrl().toString())) {
                    showRecovery(view);
                } else if (!request.isForMainFrame()) {
                    super.onReceivedError(view, request, error);
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && !isRecoveryPage(request.getUrl().toString())) {
                    showRecovery(view);
                } else if (!request.isForMainFrame()) {
                    super.onReceivedHttpError(view, request, response);
                }
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (isRecoveryPage(getBridge().getWebView().getUrl())) {
                    moveTaskToBack(true);
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        // Own Android insets once, outside the WebView. SystemBars CSS sizing
        // is disabled in config, so neither old nor new WebViews double-pad.
        // Keep the Keyboard plugin's separate content listener intact.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View webContainer = (View) getBridge().getWebView().getParent();
        webContainer.setBackgroundColor(Color.WHITE);
        ViewCompat.setOnApplyWindowInsetsListener(webContainer, (view, insets) -> {
            int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(types);
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            configureSystemBarContrast();
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(types | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(webContainer);
        configureSystemBarContrast();

        privacyShield = new TextView(this);
        privacyShield.setTag("rf-privacy-shield");
        privacyShield.setText(R.string.app_name);
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

    @Override
    public void onResume() {
        super.onResume();
        configureSystemBarContrast();
        if (getBridge() != null && recoveryReady && isRecoveryPage(getBridge().getWebView().getUrl())) {
            hidePrivacyShield();
        }
    }

    private void configureSystemBarContrast() {
        androidx.core.view.WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    @Override
    public void onDestroy() {
        cancelLoadTimeout();
        super.onDestroy();
    }

    public void hidePrivacyShield() {
        // The web runtime calls this after restoring its session gate. Do not
        // reveal employee content on a timer while the WebView is recovering.
        runOnUiThread(() -> {
            if (privacyShield != null) privacyShield.setVisibility(View.GONE);
        });
    }
}
