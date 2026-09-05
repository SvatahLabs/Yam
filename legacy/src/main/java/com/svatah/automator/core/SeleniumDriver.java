package com.svatah.automator.core;

import com.svatah.automator.mappers.FlowContextMapper;
import org.openqa.selenium.WebDriver;

import java.util.Map;

/**
 * Created by AtulSharma on 11/12/18
 */
public class SeleniumDriver extends AbstractSeleniumDriver {

    public SeleniumDriver(Map<String, String> propertyMap, FlowContextMapper flowContextMapper) {
        super(propertyMap, flowContextMapper);
    }

    @Override
    public WebDriver customBrowser(String baseUrl) {
        return null;
    }
}
