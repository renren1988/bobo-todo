package com.bobo.todo;
import android.content.*;
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) && !"android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) return;
        PendingResult pending = goAsync();
        new Thread(() -> { try { BoboStore.saveTasks(context, BoboStore.tasks(context), true); if (!BoboStore.connection(context).getString("token").isEmpty()) BoboStore.scheduleJob(context); } catch (Exception ignored) { } finally { pending.finish(); } }, "bobo-restore").start();
    }
}
