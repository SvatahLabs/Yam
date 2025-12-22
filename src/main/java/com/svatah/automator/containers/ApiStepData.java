package com.svatah.automator.containers;

/**
 * Created by AtulSharma on 14/09/18
 */
public class ApiStepData implements StepData {

    private ApiInput apiInput;
    private ApiOutput apiOutput;

    public void setInputData(Input apiInput) {
        this.apiInput = (ApiInput)apiInput;
    }

    @Override
    public ApiInput getInputData() {
        return this.apiInput;
    }

    public void setOutputData(Output apiOutput) {
        this.apiOutput = (ApiOutput)apiOutput;
    }

    @Override
    public ApiOutput getOutputData() {
        return this.apiOutput;
    }

    @Override
    public String toString() {
        return "{" +
                "\"apiInput\" : " + apiInput +
                ", \"apiOutput\" : " + apiOutput +
                '}';
    }
}
