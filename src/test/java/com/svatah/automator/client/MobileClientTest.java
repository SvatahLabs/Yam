package com.svatah.automator.client;

import io.appium.java_client.AppiumDriver;
import org.junit.Before;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.Point;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.Sequence;
import com.svatah.automator.mappers.LocatorType;

import java.util.*;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

public class MobileClientTest {

    @Mock
    private AppiumDriver driver;

    @Mock
    private WebElement element;

    @Mock
    private WebDriver.Options options;

    @Mock
    private WebDriver.Window window;

    @Mock
    private WebDriver.Timeouts timeouts;

    private MobileClient mobileClient;

    @Before
    public void setUp() {
        MockitoAnnotations.openMocks(this);
        mobileClient = new MobileClient(null);

        when(driver.manage()).thenReturn(options);
        when(options.window()).thenReturn(window);
        when(options.timeouts()).thenReturn(timeouts);
        when(window.getSize()).thenReturn(new Dimension(1080, 1920));

        when(element.getLocation()).thenReturn(new Point(0, 0));
        when(element.getSize()).thenReturn(new Dimension(100, 100));
        when(driver.findElement(any())).thenReturn(element);
        when(driver.findElements(any())).thenReturn(Collections.singletonList(element));
    }

    @Test
    public void testClick() {
        Map<LocatorType, List<String>> locatorMap = new HashMap<>();
        locatorMap.put(LocatorType.ID, Collections.singletonList("testId"));

        mobileClient.click(driver, locatorMap);

        verify(element, times(1)).click();
    }

    @Test
    public void testSingleTap() {
        Map<LocatorType, List<String>> locatorMap = new HashMap<>();
        locatorMap.put(LocatorType.ID, Collections.singletonList("testId"));

        // Mock element location/size if needed (though W3C actions usually rely on
        // coordinates or origin)
        // For simplicity in this test we assume perform is called with a Sequence

        mobileClient.singleTap(driver, locatorMap);

        ArgumentCaptor<Collection<Sequence>> argument = ArgumentCaptor.forClass((Class) Collection.class);
        verify(driver, times(1)).perform(argument.capture());

        Collection<Sequence> sequences = argument.getValue();
        assertEquals(1, sequences.size());
        // Detailed Sequence validation key/values is complex, but checking it was
        // called is a good start
    }

    @Test
    public void testDoubleTap() {
        Map<LocatorType, List<String>> locatorMap = new HashMap<>();
        locatorMap.put(LocatorType.ID, Collections.singletonList("testId"));

        mobileClient.doubleTap(driver, locatorMap);

        ArgumentCaptor<Collection<Sequence>> argument = ArgumentCaptor.forClass((Class) Collection.class);
        verify(driver, times(1)).perform(argument.capture());

        Collection<Sequence> sequences = argument.getValue();
        assertEquals(1, sequences.size());
    }

    @Test
    public void testFlick() {
        mobileClient.flick(driver, MobileClient.Direction.UP);

        ArgumentCaptor<Collection<Sequence>> argument = ArgumentCaptor.forClass((Class) Collection.class);
        verify(driver, times(1)).perform(argument.capture());

        Collection<Sequence> sequences = argument.getValue();
        assertEquals(1, sequences.size());
    }
}
