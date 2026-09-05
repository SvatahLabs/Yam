package com.svatah.automator.containers;

import com.svatah.automator.mappers.ScenarioConfigMapper;

import java.util.List;

/**
 * Created by atul on 12/09/17.
 */
public class ScenarioDetails<Action> {

    private ScenarioConfigMapper scenarioMetaData;
    private List<String> scenarioSteps;
    private List<ExecutableStep<Action>> executableSteps;

    public ScenarioDetails(List<String> scenarioSteps, List<ExecutableStep<Action>> executableSteps) {
        this.scenarioSteps = scenarioSteps;
        this.executableSteps = executableSteps;
    }

    public ScenarioDetails(ScenarioConfigMapper scenarioMetaData, List<String> scenarioSteps, List<ExecutableStep<Action>> executableSteps) {
        this.scenarioMetaData = scenarioMetaData;
        this.scenarioSteps = scenarioSteps;
        this.executableSteps = executableSteps;
    }

    public ScenarioConfigMapper getScenarioMetaData() {
        return scenarioMetaData;
    }

    public List<String> getScenarioSteps() {
        return scenarioSteps;
    }

    public List<ExecutableStep<Action>> getExecutableSteps() {
        return executableSteps;
    }

    @Override
    public String toString() {
        return "ScenarioDetails{" +
                "scenarioMetaData=" + scenarioMetaData +
                ", scenarioSteps=" + scenarioSteps +
                ", executableSteps=" + executableSteps +
                '}';
    }
}
