package com.svatah.automator.containers;

import java.util.List;

/**
 * Created by AtulSharma on 14/09/18
 */
public class SeleniumInput implements Input<LocatorMap, String> {

    private LocatorMap locatorMap;
    private List<String> inputDataList;

    @Override
    public LocatorMap get() {
        return this.locatorMap;
    }

    @Override
    public void set(LocatorMap locatorMap) {
        this.locatorMap = locatorMap;
    }

    @Override
    public List<String> getInputDataList() {
        return inputDataList;
    }

    @Override
    public void setInputDataList(List<String> inputDataList) {
        this.inputDataList = inputDataList;
    }

    @Override
    public String toString() {
        return "{" +
                "\"locatorMap\" : " + locatorMap +
                ", \"inputDataList\" : " + inputDataList +
                '}';
    }
}
