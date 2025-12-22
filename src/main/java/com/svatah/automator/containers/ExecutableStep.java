package com.svatah.automator.containers;

/**
 * Created by atul on 14/09/17.
 */
public class ExecutableStep<ActionMapper> {

    private String actionName;
    private ActionMapper actionMapper;
    private StepData stepData;
    private final Class<ActionMapper> classType;
    private String stepVariable;

    public ExecutableStep(String actionName, ActionMapper actionMapper, StepData stepData) {
        this.actionName = actionName;
        this.actionMapper = actionMapper;
        this.stepData = stepData;
        this.classType = (Class<ActionMapper>) actionMapper.getClass();
    }

    public ExecutableStep(String actionName, ActionMapper actionMapper, StepData stepData, String stepVariable) {
        this.actionName = actionName;
        this.actionMapper = actionMapper;
        this.stepData = stepData;
        this.classType = (Class<ActionMapper>) actionMapper.getClass();
        this.stepVariable = stepVariable;
    }

    public String getActionName() {
        return actionName;
    }

    public Class<ActionMapper> getActionClass() {
        return classType;
    }

    public void setActionMapping(ActionMapper actionMapper) throws IllegalAccessException {
        if (this.actionMapper == null) {
            this.actionMapper = actionMapper;
        } else {
            throw new IllegalAccessException("Action is already defined in scope");
        }
    }

    public ActionMapper getActionMapping() {
        return actionMapper;
    }

    public StepData getStepData() {
        return stepData;
    }

    public String getStepVariable() {
        return stepVariable;
    }

    @Override
    public String toString() {
        return "{" +
                "action : " + actionMapper +
                ", stepData : " + stepData.toString() +
                '}';
    }
}
