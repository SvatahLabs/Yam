package com.yam.automator.mappers;

/**
 * Created by AtulSharma on 05/11/18
 */
public class ActionSynonyms {

    private ActionDictionaryMapper<ActionMapper<?>> mapper;

    public ActionSynonyms(BuildType buildType) {
        mapper = ActionDictionaryMapper.getFreshInstance();
        if (buildType.equals(BuildType.DESKTOP))
            setDesktopMappers();
        else if (buildType.equals(BuildType.ANDROID))
            setAndroidMappers();
    }

    private void setDesktopMappers() {
        mapper.setValuesInLowerCase(SeleniumActionMapper.navigate, "open", "opens", "navigate", "navigates");
        mapper.setValuesInLowerCase(SeleniumActionMapper.forward, "forward", "go forward", "clicks on forward button");
        mapper.setValuesInLowerCase(SeleniumActionMapper.back, "back", "go back", "clicks on back button");
        mapper.setValuesInLowerCase(SeleniumActionMapper.refresh, "refresh", "refreshes", "reload", "reloads");
        mapper.setValuesInLowerCase(SeleniumActionMapper.switchToChildWindow, "switchToWindow", "switch to new window", "switches to new window", "switch to new tab", "switches to new tab");
        mapper.setValuesInLowerCase(SeleniumActionMapper.switchToMainWindow, "switchToMainWindow", "switch to main window", "switches to main window", "switch to main tab", "switches to main tab");
        mapper.setValuesInLowerCase(SeleniumActionMapper.switchToFrame, "switchToFrame", "switch to frame", "switches to frame");
        mapper.setValuesInLowerCase(SeleniumActionMapper.closeOtherWindows, "closeOtherWindows", "close other windows", "closes other windows");
        mapper.setValuesInLowerCase(SeleniumActionMapper.click, "click", "clicks");
        mapper.setValuesInLowerCase(SeleniumActionMapper.clickAndHold, "clickAndHold", "clicks and holds", "click and hold");
        mapper.setValuesInLowerCase(SeleniumActionMapper.release, "release", "releases");
        mapper.setValuesInLowerCase(SeleniumActionMapper.contextClick, "contextClick", "context click", "context clicks");
        mapper.setValuesInLowerCase(SeleniumActionMapper.doubleClick, "doubleClick", "double click", "double clicks");
        mapper.setValuesInLowerCase(SeleniumActionMapper.keyUp, "keyUp", "key up", "keys up");
        mapper.setValuesInLowerCase(SeleniumActionMapper.keyDown, "keyDown", "key down", "keys down");
        mapper.setValuesInLowerCase(SeleniumActionMapper.clear, "clear", "clears");
        mapper.setValuesInLowerCase(SeleniumActionMapper.getText, "getText", "get text", "gets text", "copy text", "save text", "saves text");
        mapper.setValuesInLowerCase(SeleniumActionMapper.type, "type", "types");
        mapper.setValuesInLowerCase(SeleniumActionMapper.submit, "submit", "submits", "click enter");
        mapper.setValuesInLowerCase(SeleniumActionMapper.dismissAlert, "dismissAlert", "dismiss alert", "dismisses alert");
        mapper.setValuesInLowerCase(SeleniumActionMapper.acceptAlert, "acceptAlert", "accept alert", "accepts alert");
        mapper.setValuesInLowerCase(SeleniumActionMapper.wait, "wait", "waits", "sleep", "sleeps", "waiting");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertSelected, "assertSelected", "assert selected", "check selected", "is selected");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertNotSelected, "assertNotSelected", "assert not selected", "is not selected");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertDisplayed, "assertDisplayed", "assert displayed", "isDisplayed", "is displayed");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertNotDisplayed, "assertNotDisplayed", "assert not displayed", "is not displayed");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertEnabled, "assertEnabled", "assert enabled", "is enabled", "is not disabled");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertDisabled, "assertDisabled", "assert disabled", "is disabled", "is not enabled");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertElementPresent, "assertElementPresent", "assert element present", "is element present");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertAlertPresent, "assertAlertPresent", "assert alert present", "is alert present");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertAlertNotPresent, "assertAlertNotPresent", "assert alert not present", "is alert not present");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateTitle, "validateTitle", "validate title", "validates title", "verifyTitle", "verify title");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateText, "validateText", "validate text", "validates text", "verifyText", "verify text");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateContainsText, "validateContainsText", "validate contains text", "contains text", "verifyContainsText", "verify contains text");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateTagName, "validateTagName", "validate tag name", "verifyTagName", "verify tag name");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateAttributeValue, "validateAttributeValue", "validate attribute value", "verifyAttributeValue", "verify attribute value");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateCssValue, "validateCssValue", "validate css value", "verifyCssValue", "verify css value");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateLocation, "validateLocation", "validate location", "verifyLocation", "verify location");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateDimension, "validateDimension", "validate dimension", "verifyDimension", "verify dimension");
        mapper.setValuesInLowerCase(SeleniumActionMapper.validateRectangle, "validateRectangle", "validate rectangle", "verifyRectangle", "verify rectangle");
        mapper.setValuesInLowerCase(SeleniumActionMapper.acceptAndValidateAlertText, "acceptAndValidateAlertText", "accept the alert and validate alert text", "accept the alert and validate displayed text");
        mapper.setValuesInLowerCase(SeleniumActionMapper.rejectAndValidateAlertText, "rejectAndValidateAlertText", "reject the alert and validate alert text", "reject the alert and validate displayed text");
        mapper.setValuesInLowerCase(SeleniumActionMapper.selectByVisibleText, "selectByVisibleText", "select by visible text", "select by shown text", "select");
        mapper.setValuesInLowerCase(SeleniumActionMapper.selectByIndex, "selectByIndex", "select by index");
        mapper.setValuesInLowerCase(SeleniumActionMapper.selectByValue, "selectByValue", "select by value", "select by sent value");
        mapper.setValuesInLowerCase(SeleniumActionMapper.deselectAll, "deselectAll", "deselect all", "remove all selections");
        mapper.setValuesInLowerCase(SeleniumActionMapper.deselectByVisibleText, "deselectByVisibleText", "deselect by visible text", "deselect by shown text", "deselect");
        mapper.setValuesInLowerCase(SeleniumActionMapper.deselectByIndex, "deselectByIndex", "deselect by index");
        mapper.setValuesInLowerCase(SeleniumActionMapper.deselectByValue, "deselectByValue", "deselect by value", "deselect by sent value");
        mapper.setValuesInLowerCase(SeleniumActionMapper.isMultipleSelectionSupported, "isMultipleSelectionSupported", "is multiple selection supported");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertMultipleSelectionSupported, "assertMultipleSelectionSupported", "assert multiple selection is supported", "validate multiple selection is supported");
        mapper.setValuesInLowerCase(SeleniumActionMapper.assertMultipleSelectionNotSupported, "assertMultipleSelectionNotSupported", "assert multiple selection is not supported", "validate multiple selection is not supported");
        mapper.setValuesInLowerCase(SeleniumActionMapper.scrollIntoView, "scrollIntoView", "scroll into view", "scroll to view");
        mapper.setValuesInLowerCase(SeleniumActionMapper.scrollToBottom, "scrollToBottom", "scroll to bottom", "scrolls to bottom", "scroll to page bottom", "scrolls to page bottom", "scroll to bottom of the page");
        mapper.setValuesInLowerCase(SeleniumActionMapper.scrollToTop, "scrollToTop", "scroll to top", "scrolls to top", "scroll to page top", "scrolls to page top", "scroll to top of the page");
        mapper.setValuesInLowerCase(SeleniumActionMapper.moveToElement, "moveToElement", "movesToElement", "move to element", "moves to element", "move over element", "moves over element", "move to element center", "moves to element center");
        mapper.setValuesInLowerCase(SeleniumActionMapper.moveToElementAndClick, "moveToElementAndClick", "movesToElementAndClick", "move to element and click", "moves to element and click", "move over element and click", "moves over element and click");
        mapper.setValuesInLowerCase(SeleniumActionMapper.explicitWaitForElementPresence, "explicitWaitForElementPresence", "wait for the presence", "waits for the presence");
        mapper.setValuesInLowerCase(SeleniumActionMapper.explicitWaitForElementVisibility, "explicitWaitForElementVisibility", "wait for the visibility", "waits for the visibility");
        mapper.setValuesInLowerCase(SeleniumActionMapper.executeScript, "executeScript", "execute script");
        mapper.setValuesInLowerCase(SeleniumActionMapper.executeAsyncScript, "executeAsyncScript", "execute async script");
        mapper.setValuesInLowerCase(HttpActionMapper.INVOKE, "invoke", "call", "hit");
        mapper.setValuesInLowerCase(HttpActionMapper.INVOKE_WITHOUT_COOKIE, "invoke without cookies", "call without cookies", "hit without cookies");
    }

    private void setAndroidMappers() {
        mapper.setValuesInLowerCase(MobileActionMapper.navigate, "open", "opens", "navigate", "navigates");
        mapper.setValuesInLowerCase(MobileActionMapper.forward, "forward", "go forward", "clicks on forward button");
        mapper.setValuesInLowerCase(MobileActionMapper.back, "back", "go back", "clicks on back button");
        mapper.setValuesInLowerCase(MobileActionMapper.refresh, "refresh", "refreshes", "reload", "reloads");
        mapper.setValuesInLowerCase(MobileActionMapper.switchToChildWindow, "switchToWindow", "switch to new window", "switches to new window", "switch to new tab", "switches to new tab");
        mapper.setValuesInLowerCase(MobileActionMapper.switchToMainWindow, "switchToMainWindow", "switch to main window", "switches to main window", "switch to main tab", "switches to main tab");
        mapper.setValuesInLowerCase(MobileActionMapper.switchToFrame, "switchToFrame", "switch to frame", "switches to frame");
        mapper.setValuesInLowerCase(MobileActionMapper.closeOtherWindows, "closeOtherWindows", "close other windows", "closes other windows");
        mapper.setValuesInLowerCase(MobileActionMapper.click, "click", "clicks");
        mapper.setValuesInLowerCase(MobileActionMapper.clickAndHold, "clickAndHold", "clicks and holds", "click and hold");
        mapper.setValuesInLowerCase(MobileActionMapper.release, "release", "releases");
        mapper.setValuesInLowerCase(MobileActionMapper.contextClick, "contextClick", "context click", "context clicks");
        mapper.setValuesInLowerCase(MobileActionMapper.doubleClick, "doubleClick", "double click", "double clicks");
        mapper.setValuesInLowerCase(MobileActionMapper.keyUp, "keyUp", "key up", "keys up");
        mapper.setValuesInLowerCase(MobileActionMapper.keyDown, "keyDown", "key down", "keys down");
        mapper.setValuesInLowerCase(MobileActionMapper.clear, "clear", "clears");
        mapper.setValuesInLowerCase(MobileActionMapper.getText, "getText", "get text", "gets text", "copy text", "save text", "saves text");
        mapper.setValuesInLowerCase(MobileActionMapper.type, "type", "types");
        mapper.setValuesInLowerCase(MobileActionMapper.submit, "submit", "submits", "click enter");
        mapper.setValuesInLowerCase(MobileActionMapper.dismissAlert, "dismissAlert", "dismiss alert", "dismisses alert");
        mapper.setValuesInLowerCase(MobileActionMapper.acceptAlert, "acceptAlert", "accept alert", "accepts alert");
        mapper.setValuesInLowerCase(MobileActionMapper.wait, "wait", "waits", "sleep", "sleeps", "waiting");
        mapper.setValuesInLowerCase(MobileActionMapper.assertSelected, "assertSelected", "assert selected", "check selected", "is selected");
        mapper.setValuesInLowerCase(MobileActionMapper.assertNotSelected, "assertNotSelected", "assert not selected", "is not selected");
        mapper.setValuesInLowerCase(MobileActionMapper.assertDisplayed, "assertDisplayed", "assert displayed", "isDisplayed", "is displayed");
        mapper.setValuesInLowerCase(MobileActionMapper.assertNotDisplayed, "assertNotDisplayed", "assert not displayed", "is not displayed");
        mapper.setValuesInLowerCase(MobileActionMapper.assertEnabled, "assertEnabled", "assert enabled", "is enabled", "is not disabled");
        mapper.setValuesInLowerCase(MobileActionMapper.assertDisabled, "assertDisabled", "assert disabled", "is disabled", "is not enabled");
        mapper.setValuesInLowerCase(MobileActionMapper.assertElementPresent, "assertElementPresent", "assert element present", "is element present");
        mapper.setValuesInLowerCase(MobileActionMapper.assertAlertPresent, "assertAlertPresent", "assert alert present", "is alert present");
        mapper.setValuesInLowerCase(MobileActionMapper.assertAlertNotPresent, "assertAlertNotPresent", "assert alert not present", "is alert not present");
        mapper.setValuesInLowerCase(MobileActionMapper.validateTitle, "validateTitle", "validate title", "validates title", "verifyTitle", "verify title");
        mapper.setValuesInLowerCase(MobileActionMapper.validateText, "validateText", "validate text", "validates text", "verifyText", "verify text");
        mapper.setValuesInLowerCase(MobileActionMapper.validateContainsText, "validateContainsText", "validate contains text", "contains text", "verifyContainsText", "verify contains text");
        mapper.setValuesInLowerCase(MobileActionMapper.validateTagName, "validateTagName", "validate tag name", "verifyTagName", "verify tag name");
        mapper.setValuesInLowerCase(MobileActionMapper.validateAttributeValue, "validateAttributeValue", "validate attribute value", "verifyAttributeValue", "verify attribute value");
        mapper.setValuesInLowerCase(MobileActionMapper.validateCssValue, "validateCssValue", "validate css value", "verifyCssValue", "verify css value");
        mapper.setValuesInLowerCase(MobileActionMapper.validateLocation, "validateLocation", "validate location", "verifyLocation", "verify location");
        mapper.setValuesInLowerCase(MobileActionMapper.validateDimension, "validateDimension", "validate dimension", "verifyDimension", "verify dimension");
        mapper.setValuesInLowerCase(MobileActionMapper.validateRectangle, "validateRectangle", "validate rectangle", "verifyRectangle", "verify rectangle");
        mapper.setValuesInLowerCase(MobileActionMapper.acceptAndValidateAlertText, "acceptAndValidateAlertText", "accept the alert and validate alert text", "accept the alert and validate displayed text");
        mapper.setValuesInLowerCase(MobileActionMapper.rejectAndValidateAlertText, "rejectAndValidateAlertText", "reject the alert and validate alert text", "reject the alert and validate displayed text");
        mapper.setValuesInLowerCase(MobileActionMapper.selectByVisibleText, "selectByVisibleText", "select by visible text", "select by shown text", "select");
        mapper.setValuesInLowerCase(MobileActionMapper.selectByIndex, "selectByIndex", "select by index");
        mapper.setValuesInLowerCase(MobileActionMapper.selectByValue, "selectByValue", "select by value", "select by sent value");
        mapper.setValuesInLowerCase(MobileActionMapper.deselectAll, "deselectAll", "deselect all", "remove all selections");
        mapper.setValuesInLowerCase(MobileActionMapper.deselectByVisibleText, "deselectByVisibleText", "deselect by visible text", "deselect by shown text", "deselect");
        mapper.setValuesInLowerCase(MobileActionMapper.deselectByIndex, "deselectByIndex", "deselect by index");
        mapper.setValuesInLowerCase(MobileActionMapper.deselectByValue, "deselectByValue", "deselect by value", "deselect by sent value");
        mapper.setValuesInLowerCase(MobileActionMapper.isMultipleSelectionSupported, "isMultipleSelectionSupported", "is multiple selection supported");
        mapper.setValuesInLowerCase(MobileActionMapper.assertMultipleSelectionSupported, "assertMultipleSelectionSupported", "assert multiple selection is supported", "validate multiple selection is supported");
        mapper.setValuesInLowerCase(MobileActionMapper.assertMultipleSelectionNotSupported, "assertMultipleSelectionNotSupported", "assert multiple selection is not supported", "validate multiple selection is not supported");
        mapper.setValuesInLowerCase(MobileActionMapper.scrollIntoView, "scrollIntoView", "scroll into view", "scroll to view");
        mapper.setValuesInLowerCase(MobileActionMapper.scrollToBottom, "scrollToBottom", "scroll to bottom", "scrolls to bottom", "scroll to page bottom", "scrolls to page bottom", "scroll to bottom of the page");
        mapper.setValuesInLowerCase(MobileActionMapper.scrollToTop, "scrollToTop", "scroll to top", "scrolls to top", "scroll to page top", "scrolls to page top", "scroll to top of the page");
        mapper.setValuesInLowerCase(MobileActionMapper.moveToElement, "moveToElement", "movesToElement", "move to element", "moves to element", "move over element", "moves over element", "move to element center", "moves to element center");
        mapper.setValuesInLowerCase(MobileActionMapper.moveToElementAndClick, "moveToElementAndClick", "movesToElementAndClick", "move to element and click", "moves to element and click", "move over element and click", "moves over element and click");
        mapper.setValuesInLowerCase(MobileActionMapper.explicitWaitForElementPresence, "explicitWaitForElementPresence", "wait for the presence", "waits for the presence");
        mapper.setValuesInLowerCase(MobileActionMapper.explicitWaitForElementVisibility, "explicitWaitForElementVisibility", "wait for the visibility", "waits for the visibility");
        mapper.setValuesInLowerCase(MobileActionMapper.executeScript, "executeScript", "execute script");
        mapper.setValuesInLowerCase(MobileActionMapper.executeAsyncScript, "executeAsyncScript", "execute async script");
        mapper.setValuesInLowerCase(HttpActionMapper.INVOKE, "invoke", "call", "hit");
        mapper.setValuesInLowerCase(HttpActionMapper.INVOKE_WITHOUT_COOKIE, "invoke without cookies", "call without cookies", "hit without cookies");
    }
}
