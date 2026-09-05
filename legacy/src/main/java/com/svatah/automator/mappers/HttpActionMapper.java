package com.svatah.automator.mappers;

public enum HttpActionMapper implements ActionMapper<HttpActionMapper> {

    INVOKE("INVOKE"),
    INVOKE_WITHOUT_COOKIE("INVOKE WITHOUT COOKIE");

    private String action;

    HttpActionMapper(String action) {
        this.action = action;
    }

    public String getAction() {
        return action;
    }

    @Override
    public HttpActionMapper getAction(String value) {
        for (HttpActionMapper action: HttpActionMapper.values()) {
            if (value.equalsIgnoreCase(action.getAction())) {
                return action;
            }
        }
        return null;
    }
}
