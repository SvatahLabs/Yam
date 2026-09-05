package com.svatah.automator.containers;

import com.svatah.automator.mappers.LocatorType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by AtulSharma on 14/09/18
 */
public class LocatorMap {

    private Map<LocatorType, List<String>> typeAndLocatorMap = new LinkedHashMap<>();;

    public LocatorMap() {
    }

    public Map<LocatorType, List<String>> getTypeAndLocatorMap() {
        return typeAndLocatorMap;
    }

    public void setTypeAndLocatorMap(Map<LocatorType, List<String>> typeAndLocatorMap) {
        this.typeAndLocatorMap = typeAndLocatorMap;
    }

    public void addTypeAndLocator(LocatorType locatorType, String locator) {
        if(typeAndLocatorMap.containsKey(locatorType))
            typeAndLocatorMap.get(locatorType).add(locator);
        else{
            List<String> locatorList = new ArrayList<>();
            locatorList.add(locator);
            typeAndLocatorMap.put(locatorType, locatorList);
        }
    }

    public void addTypeAndLocatorList(LocatorType locatorType, List<String> locatorList) {
        if(typeAndLocatorMap.containsKey(locatorType))
            typeAndLocatorMap.get(locatorType).addAll(locatorList);
        else
            typeAndLocatorMap.put(locatorType, locatorList);
    }

    @Override
    public String toString() {
        return "{" +
                "\"typeAndLocatorMap\" : " + typeAndLocatorMap +
                '}';
    }
}
