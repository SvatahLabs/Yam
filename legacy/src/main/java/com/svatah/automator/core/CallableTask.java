package com.svatah.automator.core;

import com.svatah.automator.exceptions.InitializationException;

import java.util.concurrent.Callable;

/**
 * Created by atul on 04/10/17.
 */
public class CallableTask<T> implements Callable<T> {

    public Task task;

    @Override
    public T call() throws Exception {
        return task.execute();
    }

    public abstract class Task {
        public abstract T execute() throws InitializationException;
    }
}

