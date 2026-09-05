package com.svatah.automator.core;

/**
 * Created by atul on 15/09/17.
 */
public class DependencyPair implements Comparable<DependencyPair> {
    private String currentScenario;
    private String dependsOnScenario;

    public DependencyPair(String currentScenario, String dependsOnScenario) {
        this.currentScenario = currentScenario;
        this.dependsOnScenario = dependsOnScenario;
    }

    public String getCurrentScenario() {
        return currentScenario;
    }

    public String getDependsOnScenario() {
        return dependsOnScenario;
    }

    @Override
    public int compareTo(DependencyPair dependencyPair) {
        return (this.currentScenario.compareTo(dependencyPair.currentScenario));
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        DependencyPair that = (DependencyPair) o;

        if (!currentScenario.equals(that.currentScenario)) return false;
        return dependsOnScenario != null ? dependsOnScenario.equals(that.dependsOnScenario) : that.dependsOnScenario == null;
    }

    @Override
    public int hashCode() {
        int result = currentScenario.hashCode();
        result = 31 * result + dependsOnScenario.hashCode();
        return result;
    }

    @Override
    public String toString() {
        return "DependencyPair{" +
                "currentScenario='" + currentScenario + '\'' +
                ", dependsOnScenario='" + dependsOnScenario + '\'' +
                '}';
    }
}
