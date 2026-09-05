package com.svatah.automator.containers;

public interface StepData<InputData extends Input<?, ?>, OutputData extends Output<?>> {

    void setInputData(InputData inputData);

    void setOutputData(OutputData outputData);

    InputData getInputData();

    OutputData getOutputData();
}
