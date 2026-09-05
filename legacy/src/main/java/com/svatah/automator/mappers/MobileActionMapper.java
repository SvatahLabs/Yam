package com.svatah.automator.mappers;

public enum MobileActionMapper implements ActionMapper<MobileActionMapper> {

    navigate("navigate"),
    forward("forward"),
    back("back"),
    refresh("refresh"),
    switchToChildWindow("switchToChildWindow"),
    switchToMainWindow("switchToMainWindow"),
    closeOtherWindows("closeOtherWindows"),
    switchToFrame("switchToFrame"),
    click("click"),
    clickAndHold("clickAndHold"),
    release("release"),
    doubleClick("doubleClick"),
    contextClick("contextClick"),
    clear("clear"),
    getText("getText"),
    type("type"),
    keyDown("keyDown"),
    keyUp("keyUp"),
    submit("submit"),
    dismissAlert("dismissAlert"),
    acceptAlert("acceptAlert"),
    wait("wait"),
    assertSelected("assertSelected"),
    assertNotSelected("assertNotSelected"),
    assertDisplayed("assertDisplayed"),
    assertNotDisplayed("assertNotDisplayed"),
    assertEnabled("assertEnabled"),
    assertDisabled("assertDisabled"),
    assertElementPresent("assertElementPresent"),
    assertAlertPresent("assertAlertPresent"),
    assertAlertNotPresent("assertAlertNotPresent"),
    assertMultipleSelectionSupported("assertMultipleSelectionSupported"),
    assertMultipleSelectionNotSupported("assertMultipleSelectionNotSupported"),
    validateTitle("validateTitle"),
    validateText("validateText"),
    validateContainsText("validateContainsText"),
    validateTagName("validateTagName"),
    validateAttributeValue("validateAttributeValue"),
    validateCssValue("validateCssValue"),
    validateLocation("validateLocation"),
    validateDimension("validateDimension"),
    validateRectangle("validateRectangle"),
    acceptAndValidateAlertText("acceptAndValidateAlertText"),
    rejectAndValidateAlertText("rejectAndValidateAlertText"),
    selectByVisibleText("selectByVisibleText"),
    selectByIndex("selectByIndex"),
    selectByValue("selectByValue"),
    deselectAll("deselectAll"),
    deselectByVisibleText("deselectByVisibleText"),
    deselectByIndex("deselectByIndex"),
    deselectByValue("deselectByValue"),
    isMultipleSelectionSupported("isMultipleSelectionSupported"),
    scrollIntoView("scrollIntoView"),
    scrollToBottom("scrollToBottom"),
    scrollToTop("scrollToTop"),
    moveToElement("moveToElement"),
    moveToElementAndClick("moveToElementAndClick"),
    explicitWaitForElementPresence("explicitWaitForElementPresence"),
    explicitWaitForElementVisibility("explicitWaitForElementVisibility"),
    executeScript("executeScript"),
    executeAsyncScript("executeAsyncScript");

    private String action;

    MobileActionMapper(String action) {
        this.action = action;
    }

    public String getAction() {
        return action;
    }

    @Override
    public MobileActionMapper getAction(String value) {
        for (MobileActionMapper action: MobileActionMapper.values()) {
            if (value.equalsIgnoreCase(action.getAction())) {
                return action;
            }
        }
        return null;
    }
}
