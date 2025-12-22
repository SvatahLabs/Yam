package com.svatah.automator.core;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Created by atul on 11/04/17.
 */
public class ThreadHeap {

    private int threadCount = 1;

    public ThreadHeap(int threadCount) {
        this.threadCount = threadCount;
    }

    public void spawn(Runnable runnable) {
        for (int num = 0; num < threadCount; num++) {
            Thread t = new Thread(runnable);
            t.start();
        }
    }

    public void spawnViaExecutor(List<Runnable> runnableTask) {
        int taskSize = runnableTask.size();
        ExecutorService executor = Executors.newScheduledThreadPool(taskSize);
        for (int num = 0; num < threadCount; num++) {
            executor.submit(runnableTask.get(num));
        }
    }

    public void spawn(List<CallableTask<CallableTask.Task>> tasks) {
        ExecutorService executor = Executors.newScheduledThreadPool(threadCount);
        try {
            executor.invokeAll(tasks);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        executor.shutdown();

    }
}

