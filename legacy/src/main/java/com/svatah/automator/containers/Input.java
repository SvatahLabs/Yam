package com.svatah.automator.containers;

import java.util.List;

public interface Input<IdentityType, InputType> {

    List<InputType> getInputDataList();

    void setInputDataList(List<InputType> inputDataList);

    IdentityType get();

    void set(IdentityType type);
}
