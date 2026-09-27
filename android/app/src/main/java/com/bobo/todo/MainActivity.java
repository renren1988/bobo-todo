package com.bobo.todo;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.*;
import android.view.*;
import android.graphics.Color;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import android.app.DownloadManager;

public class MainActivity extends Activity {
    private WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String exportText;
    private static final String ORIGIN = "https://bobo.local";
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); BoboStore.channel(this);
        web = new WebView(this); web.setBackgroundColor(Color.rgb(248,247,242)); setContentView(web);
        if (Build.VERSION.SDK_INT >= 35) web.setOnApplyWindowInsetsListener((view, insets) -> { android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime()); view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets; });
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setTextZoom(100); web.addJavascriptInterface(new Bridge(), "BoboAndroid");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("移除", (d,w) -> result.confirm()).setNegativeButton("取消", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { if (request.isForMainFrame() && request.getUrl().toString().equals("https://github.com/renren1988/bobo-todo/releases")) { try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) {} return true; } return !request.getUrl().toString().equals(ORIGIN + "/"); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl(); String name = uri.getPath();
                if (!uri.getScheme().equals("https") || !uri.getHost().equals("bobo.local")) return denied();
                if (name.equals("/")) name = "/index.html";
                if (!name.matches("/(index.html|style.css|native.js|app.js|shared.js|icon.svg|icon192.png|icon512.png|manifest.webmanifest)")) return denied();
                try {
                    String mime = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".png") ? "image/png" : name.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
                    Map<String,String> headers = new HashMap<>(); headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("public" + name));
                } catch (Exception e) { return denied(); }
            }
        });
        web.loadUrl(ORIGIN + "/");
    }
    private WebResourceResponse denied() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    private void reply(int id, Object value, Exception error) {
        try {
            JSONObject result = new JSONObject(); if (error != null) result.put("error", error.getMessage() == null ? "连接失败，请检查网络与电脑地址" : error.getMessage()); else result.put("value", value == null ? JSONObject.NULL : value);
            final String js = "window.__boboReply(" + id + "," + result.toString() + ")";
            runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
        } catch (JSONException ignored) { }
    }
    private class Bridge {
        @JavascriptInterface public void call(int id, String payload) {
            if (payload.length() > 8000000) { reply(id, null, new IOException("请求过大")); return; }
            worker.execute(() -> {
                try {
                    JSONObject message = new JSONObject(payload); String action = message.getString("action"); Object result = true;
                    switch (action) {
                        case "getConnection": result = BoboStore.connection(MainActivity.this); break;
                        case "setConnection": BoboStore.setConnection(MainActivity.this, message.optJSONObject("value")); break;
                        case "request": result = BoboStore.request(message.getJSONObject("value")); break;
                        case "updateTasks": BoboStore.saveTasks(MainActivity.this, message.getJSONArray("value"), false); break;
                        case "enableNotifications": runOnUiThread(() -> enableNotifications()); break;
                        case "checkAppUpdate": result = appUpdate(); break;
                        case "downloadAppUpdate": downloadAppUpdate(message.getString("value")); break;
                        case "exportBackup": exportText = message.getString("value"); runOnUiThread(() -> { Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"bobo-backup.json"); startActivityForResult(intent, 803); }); break;
                        default: throw new IOException("不支持的设备操作");
                    }
                    reply(id, result, null);
                } catch (Exception error) { reply(id, null, error); }
            });
        }
    }
    private JSONObject appUpdate() throws Exception {
        URL url = new URL("https://bobo.taorenlove.live/android-version.json");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setConnectTimeout(5000); connection.setReadTimeout(8000);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[4096]; int n; while ((n = input.read(buffer)) != -1) { out.write(buffer, 0, n); if (out.size() > 100000) throw new IOException("版本信息过大"); } JSONObject info = new JSONObject(out.toString("UTF-8")); String latest = info.getString("version");
            String current = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; info.put("available", compareVersions(latest, current) > 0); return info;
        } finally { connection.disconnect(); }
    }
    private int compareVersions(String a, String b) { String[] x = a.split("\\."), y = b.split("\\."); for (int i = 0; i < Math.max(x.length, y.length); i++) { int left = i < x.length ? Integer.parseInt(x[i]) : 0, right = i < y.length ? Integer.parseInt(y[i]) : 0; if (left != right) return Integer.compare(left, right); } return 0; }
    private void downloadAppUpdate(String value) throws Exception {
        URL checked = new URL(value); if (!checked.getProtocol().equals("https") || !checked.getHost().equals("bobo.taorenlove.live") || !checked.getPath().matches("/downloads/BoboTodo-[0-9.]+-Android\\.apk")) throw new IOException("更新地址不受信任");
        DownloadManager manager = (DownloadManager)getSystemService(DOWNLOAD_SERVICE); DownloadManager.Request request = new DownloadManager.Request(Uri.parse(value)); request.setTitle("啵啵待办更新").setDescription("正在下载新的 Android 版本").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED).setMimeType("application/vnd.android.package-archive"); manager.enqueue(request);
    }
    private void enableNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 801); return; }
        AlarmManager alarm = (AlarmManager)getSystemService(ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) new AlertDialog.Builder(this).setTitle("允许准时提醒").setMessage("允许啵啵设置闹钟，才能尽量按你设置的分钟数提醒；未允许时系统可能推迟通知。").setPositiveButton("前往设置", (d,w) -> startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())))).setNegativeButton("稍后", null).show();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] granted) { super.onRequestPermissionsResult(request, permissions, granted); if (request == 801 && granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED) enableNotifications(); }
    @Override protected void onResume() { super.onResume(); worker.execute(() -> { try { BoboStore.saveTasks(this, BoboStore.tasks(this), true); BoboStore.refresh(this); } catch (Exception ignored) { } }); }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request,result,data); if (request == 803 && result == RESULT_OK && data != null && exportText != null) worker.execute(() -> { try (OutputStream out = getContentResolver().openOutputStream(data.getData())) { out.write(exportText.getBytes("UTF-8")); } catch (Exception e) { runOnUiThread(() -> new AlertDialog.Builder(this).setMessage("备份保存失败，请重试").setPositiveButton("知道了",null).show()); } }); }
    @Override public void onBackPressed() { web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true}return false})()", value -> { if (!"true".equals(value)) moveTaskToBack(true); }); }
    @Override protected void onDestroy() { worker.shutdown(); if (web != null) { web.removeJavascriptInterface("BoboAndroid"); web.destroy(); web = null; } super.onDestroy(); }
}
