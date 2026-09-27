package com.bobo.todo;
import android.app.job.*;
public class SyncJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) { new Thread(() -> { boolean retry = false; try { BoboStore.refresh(this); } catch (Exception e) { retry = true; } jobFinished(params, retry); }, "bobo-sync").start(); return true; }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
