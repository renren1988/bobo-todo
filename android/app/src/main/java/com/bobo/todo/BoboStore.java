package com.bobo.todo;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.content.pm.PackageManager;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

public final class BoboStore {
    static final String CHANNEL = "bobo-reminders";
    static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("bobo", Context.MODE_PRIVATE); }
    static JSONObject connection(Context c) throws JSONException {
        return new JSONObject().put("url", prefs(c).getString("url", "https://bobo.taorenlove.live")).put("token", prefs(c).getString("token", "")).put("tasks", tasks(c));
    }
    static String validateUrl(String text) throws Exception {
        URL u = new URL(text);
        if (!u.getProtocol().equals("https") || !u.getHost().equals("bobo.taorenlove.live") || (u.getPort() != -1 && u.getPort() != 443) || u.getUserInfo() != null || u.getQuery() != null || u.getRef() != null || !(u.getPath().isEmpty() || u.getPath().equals("/"))) throw new IOException("请连接啵啵账号服务");
        return "https://bobo.taorenlove.live";
    }
    static synchronized void setConnection(Context c, JSONObject value) throws Exception {
        String url = "https://bobo.taorenlove.live";
        String token = value == null ? "" : value.optString("token", "");
        if (!url.isEmpty()) url = validateUrl(url);
        if (token.length() > 256) throw new IOException("登录凭据过长");
        if (!token.equals(prefs(c).getString("token", ""))) saveTasks(c, new JSONArray(), true);
        prefs(c).edit().putString("url", url).putString("token", token).commit();
        if (!token.isEmpty()) scheduleJob(c);
        else ((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).cancel(802);
    }
    static JSONObject request(JSONObject value) throws Exception {
        String route = value.getString("route"), method = value.getString("method"), token = value.getString("token");
        if (!route.matches("tasks(/[a-f0-9-]+)?|push|auth/(register|login|recover|me|logout|migrate)") || !Arrays.asList("GET", "POST", "PUT", "DELETE").contains(method) || token.length() > 256) throw new IOException("无效请求");
        URL url = new URL(validateUrl(value.getString("url")) + "/api/" + route);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(4000); conn.setReadTimeout(5000); conn.setInstanceFollowRedirects(false);
        conn.setRequestMethod(method); conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try {
            if (value.has("data") && !value.isNull("data")) {
                byte[] data = value.get("data").toString().getBytes(StandardCharsets.UTF_8);
                if (data.length > 16384) throw new IOException("请求过大");
                conn.setDoOutput(true); try (OutputStream out = conn.getOutputStream()) { out.write(data); }
            }
            int status = conn.getResponseCode();
            InputStream input = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (input == null) throw new IOException("服务暂时无法连接");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
            try (InputStream in = input) { while ((count = in.read(buffer)) != -1) { bytes.write(buffer, 0, count); if (bytes.size() > 16000000) throw new IOException("响应过大"); } }
            JSONObject result = new JSONObject(bytes.toString("UTF-8"));
            if (status < 200 || status >= 300) throw new IOException(result.optString("error", "连接失败，请检查网络或重新登录"));
            return result;
        } finally { conn.disconnect(); }
    }
    static synchronized JSONArray tasks(Context c) throws JSONException { return new JSONArray(prefs(c).getString("tasks", "[]")); }
    static PendingIntent alarm(Context c, String id) {
        Intent intent = new Intent(c, AlarmReceiver.class).setData(Uri.parse("bobo://task/" + Uri.encode(id))).putExtra("id", id);
        return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static String key(JSONObject task) { return task.optString("id") + ":" + task.optString("due") + ":" + task.optInt("reminder", 30); }
    static long due(JSONObject task) { try { return Instant.parse(task.getString("due")).toEpochMilli(); } catch (Exception e) { return 0; } }
    static synchronized void saveTasks(Context c, JSONArray values, boolean force) throws Exception {
        if (values.length() > 10000) throw new IOException("待办过多");
        for (int i = 0; i < values.length(); i++) {
            JSONObject t = values.getJSONObject(i);
            if (t.getString("id").length() > 100 || t.getString("title").length() > 200 || t.getInt("reminder") < 0 || t.getInt("reminder") > 525600) throw new IOException("待办格式错误");
        }
        if (!force && values.toString().equals(prefs(c).getString("tasks", "[]"))) return;
        AlarmManager manager = (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
        JSONArray previous = tasks(c);
        for (int i = 0; i < previous.length(); i++) manager.cancel(alarm(c, previous.getJSONObject(i).optString("id")));
        prefs(c).edit().putString("tasks", values.toString()).commit();
        Set<String> sent = prefs(c).getStringSet("sent", Collections.emptySet()); long now = System.currentTimeMillis();
        for (int i = 0; i < values.length(); i++) {
            JSONObject task = values.getJSONObject(i); long due = due(task);
            if (task.optBoolean("done") || due == 0 || now > due + 86400000L || sent.contains(key(task))) continue;
            long at = Math.max(now + 1500, due - task.optInt("reminder", 30) * 60000L);
            PendingIntent pending = alarm(c, task.getString("id"));
            if (Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }
    static synchronized void refresh(Context c) throws Exception {
        JSONObject config = connection(c); if (config.getString("token").isEmpty()) return;
        JSONObject result;
        try { result = request(new JSONObject().put("url", config.getString("url")).put("token", config.getString("token")).put("route", "tasks").put("method", "GET")); }
        catch (Exception error) { if (error.getMessage() != null && error.getMessage().contains("登录已失效")) saveTasks(c, new JSONArray(), true); throw error; }
        // Synchronizing on this class keeps connection switches and background results ordered.
        saveTasks(c, result.getJSONArray("tasks"), false);
    }
    static void scheduleJob(Context c) {
        JobInfo job = new JobInfo.Builder(802, new ComponentName(c, SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build();
        ((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).schedule(job);
    }
    static void channel(Context c) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "啵啵待办提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("按每件事情设置的时间，轻轻提醒你");
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }
    static synchronized void notifyTask(Context c, String id) throws Exception {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        channel(c); JSONArray all = tasks(c);
        for (int i = 0; i < all.length(); i++) {
            JSONObject task = all.getJSONObject(i); long end = due(task), now = System.currentTimeMillis();
            if (!task.optString("id").equals(id) || task.optBoolean("done") || end == 0 || now < end - task.optInt("reminder", 30) * 60000L || now > end + 86400000L) continue;
            Set<String> sent = new HashSet<>(prefs(c).getStringSet("sent", Collections.emptySet()));
            if (sent.contains(key(task))) return;
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent content = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String timing = end <= now ? "已到截止时间" : "还有 " + (long)Math.ceil((end - now) / 60000.0) + " 分钟截止";
            Notification note = new Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("啵啵轻轻提醒你").setContentText(task.getString("title") + " · " + timing).setStyle(new Notification.BigTextStyle().bigText(task.getString("title") + "\n" + timing)).setContentIntent(content).setAutoCancel(true).build();
            ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, 1, note);
            sent.add(key(task)); prefs(c).edit().putStringSet("sent", sent).commit();
        }
    }
}
