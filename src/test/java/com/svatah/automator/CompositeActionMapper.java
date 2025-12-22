package com.svatah.automator;

import com.svatah.automator.mappers.ActionMapper;
import com.svatah.automator.mappers.SeleniumActionMapper;

/**
 * Created by atul on 14/09/17.
 */
public enum CompositeActionMapper implements ActionMapper {

    login("login");

    public static CompositeActionMapper instance;

    private final String action;

    CompositeActionMapper(String action) {
        this.action = action;
    }

    public String getAction() {
        return action;
    }

    @Override
    public CompositeActionMapper getAction(String value) {
        for (CompositeActionMapper action : CompositeActionMapper.values()) {
            if (value.equals(action.toString())) {
                return action;
            }
        }
        return null;
    }
}
