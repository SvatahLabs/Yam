package com.svatah.automator.containers;

import java.util.StringJoiner;

public class ProjectExecutionRecorder {

    private long id;
    private String url;
    private String browser;

    public ProjectExecutionRecorder(long id, String url, String browser) {
        this.id = id;
        this.url = url;
        this.browser = browser;
    }

    public long getId() {
        return id;
    }

    public void setId(long id) {
        this.id = id;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getBrowser() {
        return browser;
    }

    public void setBrowser(String browser) {
        this.browser = browser;
    }

    @Override
    public String toString() {
        return new StringJoiner(", ", ProjectExecutionRecorder.class.getSimpleName() + "[", "]")
                .add("id=" + id)
                .add("url='" + url + "'")
                .add("browser='" + browser + "'")
                .toString();
    }
}
