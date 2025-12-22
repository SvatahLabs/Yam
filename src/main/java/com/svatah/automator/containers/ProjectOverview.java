package com.svatah.automator.containers;

import com.svatah.automator.core.Config;
import com.svatah.automator.mappers.ProjectKeywords;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Created by atul on 12/09/17.
 */
public class ProjectOverview {

    private Config projectConfig;
    private static Map<String, ScenarioDetails> scenarioDetailsMap;
    private static Map<String, ApiRequest> apiCallsMap;
    private static Map<String, List<String>> compositionsMap;
    private static Map<String, List<String>> executionOrderMap;

    ProjectOverview() {
        scenarioDetailsMap = new ConcurrentHashMap<>();
        apiCallsMap = new ConcurrentHashMap<>();
        compositionsMap = new ConcurrentHashMap<>();
        executionOrderMap = new ConcurrentHashMap<>();
    }

    public Config getProjectConfig() {
        return projectConfig;
    }

    public void setProjectConfig(Config projectConfig) {
        this.projectConfig = projectConfig;
    }

    public Map<String, ScenarioDetails> getScenariosDetails() {
        return scenarioDetailsMap;
    }

    public Map<String, ApiRequest> getApiCallsMap() {
        return apiCallsMap;
    }

    public Map<String, List<String>> getFlowExecutionOrder() {
        return executionOrderMap;
    }

    public Map<String, List<String>> getCompositionsMap() {
        return compositionsMap;
    }

    public void setApiCallsMap(Map<String, ApiRequest> apiCallsMap) {
        ProjectOverview.apiCallsMap = apiCallsMap;
    }

    public void addScenarioEntry(String type, String flowFileName, String scenarioName, ScenarioDetails scenarioDetails) {
        if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword()))
            scenarioDetailsMap.put(scenarioName, scenarioDetails);
        addEntryToMapProperly(executionOrderMap, flowFileName, scenarioName);
    }

    public void addStoryEntry(String type, String scenarioName, ScenarioDetails scenarioDetails) {
        if (type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword()))
            scenarioDetailsMap.put(scenarioName, scenarioDetails);
    }

    public void addExecutionEntry(String type, String flowFileName, String scenarioName) {
        if (type.equalsIgnoreCase(ProjectKeywords.TEST.getKeyword()))
            addEntryToMapProperly(executionOrderMap, flowFileName, scenarioName);
    }

    public void addCompositionEntry(String compositionName, String scenarioName) {
        addEntryToMapProperly(compositionsMap, compositionName, scenarioName);
    }

    private void addEntryToMapProperly(Map<String, List<String>> map, String key, String value) {
        if (!map.containsKey(key)) {
            List<String> valueList = new ArrayList<>();
            valueList.add(value);
            map.put(key, valueList);
        } else {
            map.get(key).add(value);
        }
    }
}
