package com.svatah.automator.containers;

/**
 * Created by AtulSharma on 14/09/18
 */
public class ApiOutput implements Output<String> {

    private String extractData;

    @Override
    public String get() {
        return this.extractData;
    }

    @Override
    public void set(String extractData) {
        this.extractData = extractData;
    }

    @Override
    public String toString() {
        return "{" +
                "\"extractData\" : \"" + extractData + '\"' +
                '}';
    }
}
