package com.svatah.automator.exceptions;

import com.svatah.automator.mappers.LocatorType;

import java.util.List;
import java.util.Map;

/**
 * Created by atul on 12/09/17.
 */
public class LocatorNotFoundError extends AssertionError {

    private String message = "";

    public LocatorNotFoundError(Map<LocatorType, List<String>> typeAndLocatorMap) {
        super(typeAndLocatorMap.toString());
        this.message = message +"\nlocators : "+typeAndLocatorMap.toString();
    }

    public LocatorNotFoundError(Map<LocatorType, List<String>> typeAndLocatorMap, String message) {
        super(message +"\nlocators : "+typeAndLocatorMap.toString());
        this.message = message +"\nlocators : "+typeAndLocatorMap.toString();
    }

    public LocatorNotFoundError(Map<LocatorType, List<String>> typeAndLocatorMap, String message, Throwable cause) {
        super(message +"\nlocators : "+typeAndLocatorMap.toString(), cause);
        this.message = message +"\nlocators : "+typeAndLocatorMap.toString();
    }

    @Override
    public String getMessage() {
        return message;
    }

    @Override
    public String toString() {
        return "{" +
                ", message:'" + message + '\'' +
                '}';
    }
}
