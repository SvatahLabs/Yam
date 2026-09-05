package com.svatah.automator.containers;

import java.util.List;

/**
 * Created by AtulSharma on 14/09/18
 */
public class ApiInput implements Input<ApiRequest, String> {

    private ApiRequest apiRequest;
    private List<String> inputDataList;

    @Override
    public ApiRequest get() {
        return this.apiRequest;
    }

    @Override
    public void set(ApiRequest apiRequest) {
        this.apiRequest = apiRequest;
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
                "\"apiRequest\" : " + apiRequest +
                ", \"inputDataList\" : " + inputDataList +
                '}';
    }
}
