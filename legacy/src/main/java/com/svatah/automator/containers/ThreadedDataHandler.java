package com.svatah.automator.containers;

import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.ProjectAlreadyRegisteredException;

import java.util.Queue;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Created by AtulSharma on 25/01/18
 */
public class ThreadedDataHandler {

    private static volatile ThreadedDataHandler instance;
    private static Object mutex = new Object();

    private static Map<Long, ProjectOverview> threadedProjectsMap;
    private static Map<Long, ResultCollector> resultCollectorMap;
    private static Queue<ProjectExecutionRecorder> projectExecutionQueue;


    private ThreadedDataHandler(){
        threadedProjectsMap = new ConcurrentHashMap<>();
        resultCollectorMap = new ConcurrentHashMap<>();
        projectExecutionQueue = new ConcurrentLinkedQueue<>();
    }

    public static ThreadedDataHandler getInstance(){
        ThreadedDataHandler result = instance;
        if (result == null) {
            synchronized (mutex) {
                result = instance;
                if (result == null)
                    instance = result = new ThreadedDataHandler();
            }
        }
        return result;
    }

    public ProjectOverview getProjectOverview(Long id){
        return threadedProjectsMap.get(id);
    }

    public ResultCollector getResults(Long id){
        return resultCollectorMap.getOrDefault(id, null);
    }

    public ProjectOverview registerProjectOverview(Long id, Config config) throws ProjectAlreadyRegisteredException {
        if(!threadedProjectsMap.containsKey(id)) {
            ProjectOverview overview = new ProjectOverview();
            overview.setProjectConfig(config);
            threadedProjectsMap.put(id, overview);
            projectExecutionQueue.add(new ProjectExecutionRecorder(id, config.getUrl(), config.getBrowser()));
            return overview;
        }
        else{
            throw new ProjectAlreadyRegisteredException("A Project has already been registered with the given id : "+id);
        }
    }

    public ResultCollector registerResultCollector(Long id) throws ProjectAlreadyRegisteredException {
        if(!resultCollectorMap.containsKey(id)) {
            ResultCollector collector = new ResultCollector();
            resultCollectorMap.put(id, collector);
            return collector;
        }
        else{
            throw new ProjectAlreadyRegisteredException("Failure Collectors has already been registered for Project with the given id : "+id);
        }
    }

    public Map<Long, ProjectOverview> getThreadedProjectsMap() {
        return threadedProjectsMap;
    }

    public Map<Long, ResultCollector> getResultCollectorMap(){
        return resultCollectorMap;
    }

    public Queue<ProjectExecutionRecorder> getProjectExecutionQueue() {
        return projectExecutionQueue;
    }

    //TODO : Alternate method in lieu of automatic garbage collector to remove the entry once the invoking thread goes out of scope after completing the action.
    public void removeEntry(long id){
        threadedProjectsMap.remove(id);
        resultCollectorMap.remove(id);
    }
}
