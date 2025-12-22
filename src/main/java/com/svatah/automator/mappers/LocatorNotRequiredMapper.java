package com.svatah.automator.mappers;


import java.util.HashSet;
import java.util.Set;

public class LocatorNotRequiredMapper {

    private static Set<SeleniumActionMapper> actionsWithoutLocatorsSet = new HashSet<>();
    private static Set<MobileActionMapper> mobileActionsWithoutLocatorsSet = new HashSet<>();


    static {
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.wait);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.navigate);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.forward);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.back);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.refresh);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.switchToMainWindow);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.switchToChildWindow);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.closeOtherWindows);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.release);
        actionsWithoutLocatorsSet.add(SeleniumActionMapper.validateTitle);

        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.wait);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.navigate);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.forward);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.back);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.refresh);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.switchToMainWindow);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.switchToChildWindow);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.closeOtherWindows);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.release);
        mobileActionsWithoutLocatorsSet.add(MobileActionMapper.validateTitle);
    }

    public static Set<SeleniumActionMapper> getActionsWithoutLocatorsSet() {
        return actionsWithoutLocatorsSet;
    }

    public static Set<MobileActionMapper> getMobileActionsWithoutLocatorsSet() {
        return mobileActionsWithoutLocatorsSet;
    }
}
