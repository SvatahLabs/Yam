package com.svatah.automator.mappers;

/**
 * Created by atul on 12/09/17.
 */
public enum LocatorType {
    ID("id", "id", "id"),
    CSS_SELECTOR("cssSelector", "css selector", "css"),
    NAME("name", "name", "name"),
    CLASS_NAME("className", "class", "class"),
    LINK_TEXT("linkText", "link text", "link"),
    XPATH("xpath", "xpath", "xpath"),
    PARTIAL_LINK_TEXT("partialLinkText", "partial link text", "plt"),
    TAG_NAME("tagName", "tag name", "tag"),
    TEXT("text", "text", "txt"),
    IMAGE("image", "image", "img");

    private final String locatorType;
    private final String locatorTypeExp;
    private final String locatorTypeShortHand;

    LocatorType(String locatorType, String locatorTypeExp, String locatorTypeShortHand) {
        this.locatorType = locatorType;
        this.locatorTypeExp = locatorTypeExp;
        this.locatorTypeShortHand =  locatorTypeShortHand;
    }

    public String getLocatorType() {
        return locatorType;
    }

    public String getLocatorTypeExp(){
        return locatorTypeExp;
    }

    public String getLocatorTypeShortHand() {
        return locatorTypeShortHand;
    }

    public static LocatorType getLocatorType(String value) {
        for (LocatorType locatorType : LocatorType.values()) {
            if (value.equals(locatorType.getLocatorType())) {
                return locatorType;
            }
            else if (value.equals(locatorType.getLocatorTypeExp())) {
                return locatorType;
            }
            else if (value.equals(locatorType.getLocatorTypeShortHand())) {
                return locatorType;
            }
        }
        return null;
    }
}

