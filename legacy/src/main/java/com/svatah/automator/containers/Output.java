package com.svatah.automator.containers;

/**
 * Created by AtulSharma on 14/09/18
 */
public interface Output<Type> {

    Type get();

    void set(Type type);
}
