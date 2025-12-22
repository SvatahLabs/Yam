package com.svatah.automator.containers;

/**
 * Created by atul on 12/09/17.
 */
public class ReturnType<R> {

    private final Class<R> classType;
    private R value;

    public ReturnType(Class<R> classType) {
        this.classType = classType;
    }

    public Class<R> getClassType() {
        return this.classType;
    }

    public R getData() {
        return value;
    }

    public void setValue(R value) {
        this.value = value;
    }

    @Override
    public String toString() {
        return "{" +
                "\"classType\" : " + classType +
                ",\"value\" : \"" + value + "\"" +
                '}';
    }
}
