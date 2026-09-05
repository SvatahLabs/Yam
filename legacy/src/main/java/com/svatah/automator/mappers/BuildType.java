package com.svatah.automator.mappers;

public enum  BuildType {
    DESKTOP("DESKTOP"),
    ANDROID("ANDROID"),
    IOS("IOS"),
    API("API");

    private String buildType;

    BuildType(String buildType) {
        this.buildType = buildType;
    }

    public String getMethod() {
        return buildType;
    }
}
