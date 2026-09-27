package com.bobo.todo;
import android.content.*;
public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync(); String id = intent.getStringExtra("id");
        new Thread(() -> { try { try { BoboStore.refresh(context); } catch (Exception ignored) { } BoboStore.notifyTask(context, id); } catch (Exception ignored) { } finally { pending.finish(); } }, "bobo-alarm").start();
    }
}
