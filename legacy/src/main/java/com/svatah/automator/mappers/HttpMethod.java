package com.svatah.automator.mappers;

/**
 * Created by AtulSharma on 14/09/18
 */
public enum HttpMethod {

    GET("GET"),
    POST("POST"),
    PUT("PUT"),
    DELETE("DELETE"),
    PATCH("PATCH");

    private String method;

    HttpMethod(String method) {
        this.method = method;
    }

    public String getMethod() {
        return method;
    }
}
