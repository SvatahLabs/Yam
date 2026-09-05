package com.svatah.automator.action;

import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.containers.StepData;
import com.svatah.automator.exceptions.InvalidStepDataException;
import com.svatah.automator.mappers.ActionMapper;
import org.openqa.selenium.WebDriver;

/**
 * Created by atul on 12/09/17.
 */
public interface Action<D extends WebDriver, T extends ActionMapper, S extends StepData> {

    ReturnType<?> perform(D driver, T action, S stepData) throws InvalidStepDataException;
}
