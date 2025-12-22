package com.svatah.automator.core;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by atul on 15/09/17.
 */
public class DependencyMap {

    private static DependencyMap dependencyMap = null;
    private List<DependencyPair> dependencyPairList;

    private DependencyMap() {
        dependencyPairList = new ArrayList<>();
    }

    public static DependencyMap getInstance() {
        if (dependencyMap == null) {
            dependencyMap = new DependencyMap();
        }
        return dependencyMap;
    }

    public List<DependencyPair> getDependencyPairList() {
        return dependencyPairList;
    }

    public void addEntry(DependencyPair dependencyPair) {
        dependencyPairList.add(dependencyPair);
    }
}
