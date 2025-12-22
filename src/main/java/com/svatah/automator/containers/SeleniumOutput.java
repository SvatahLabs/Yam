package com.svatah.automator.containers;

import java.util.Collections;
import java.util.List;

/**
 * Created by AtulSharma on 14/09/18
 */
public class SeleniumOutput implements Output<List<String>> {

    private List<String> outputData = Collections.emptyList();

    @Override
    public List<String> get() {
        return this.outputData;
    }

    @Override
    public void set(List<String> outputData) {
        this.outputData = outputData;
    }
}
