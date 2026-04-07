# Cars App Monitoring Setup

This directory contains monitoring and observability configurations for the Cars application.

## Available Metrics

### Business Metrics
- **Cars**: Total, active, sold, pending counts
- **Users**: Total, active, verified, subscriber counts
- **Workshops**: Total, active, certified counts
- **Messages**: Total, unread, daily counts
- **Notifications**: Total, unread, daily counts
- **Appointments**: Total, pending, completed, daily counts

### System Metrics
- **Uptime**: Server uptime in seconds
- **Version**: Application version
- **Timestamp**: Last metrics collection time

## Endpoints

### Prometheus Metrics
```
GET /metrics
```
Returns metrics in Prometheus format for scraping by monitoring systems.

### JSON Metrics
```
GET /api/metrics
```
Returns all metrics in JSON format for application consumption.

### Admin Dashboard Summary
```
GET /api/admin/metrics-summary
Authorization: Bearer <admin-token>
```
Returns summarized metrics with trends and alerts for admin dashboards.

## Grafana Dashboard

Import the provided `grafana-dashboard.json` into your Grafana instance:

1. Open Grafana
2. Go to "+" → Import
3. Upload `grafana-dashboard.json`
4. Configure your Prometheus data source

The dashboard includes:
- Active cars, users, and workshops counters
- System uptime monitoring
- Messages and notifications trends
- Car status distribution (pie chart)
- Appointments status over time

## Prometheus Configuration

Add the following to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'cars-app'
    static_configs:
      - targets: ['localhost:7000']  # Adjust port as needed
    metrics_path: '/metrics'
    scrape_interval: 30s
```

## Docker Compose Setup

Example monitoring stack with Prometheus and Grafana:

```yaml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-storage:/var/lib/grafana

volumes:
  grafana-storage:
```

## Alerting Rules

Example Prometheus alerting rules:

```yaml
groups:
  - name: cars_app_alerts
    rules:
      - alert: HighUnreadNotifications
        expr: notifications_unread > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High number of unread notifications"
          description: "{{ $value }} unread notifications detected"

      - alert: LowWorkshopCount
        expr: workshops_active < 5
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Low workshop availability"
          description: "Only {{ $value }} workshops are active"

      - alert: SystemDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Cars application is down"
          description: "Cars application has been down for more than 1 minute"
```

## Health Checks

The application provides health check endpoints:

- `/api/health` - Basic health check with Redis status
- `/api/cache/warmup` - POST endpoint to warm up caches
- `/api/metrics` - Application metrics for monitoring

## Performance Monitoring

Key performance indicators to monitor:

1. **Response Times**: Monitor API response times
2. **Error Rates**: Track 4xx and 5xx error rates
3. **Cache Hit Rates**: Monitor Redis cache performance
4. **Database Performance**: Track query execution times
5. **Memory Usage**: Monitor Node.js memory consumption
6. **CPU Usage**: Track server CPU utilization

## Scaling Indicators

Monitor these metrics for scaling decisions:

- **Active Users**: Scale when approaching capacity limits
- **Message Volume**: Scale chat infrastructure based on daily message counts
- **Database Connections**: Monitor connection pool usage
- **Redis Memory**: Track Redis memory usage for cache scaling
- **Response Times**: Scale when average response time > 500ms

## Troubleshooting

### High Memory Usage
- Check for memory leaks in Node.js
- Monitor garbage collection performance
- Review Redis memory usage and eviction policies

### High CPU Usage
- Monitor expensive database queries
- Check for inefficient algorithms
- Review Socket.IO connection counts

### High Error Rates
- Check application logs with correlation IDs
- Monitor database connection errors
- Review authentication failure rates

### Cache Issues
- Monitor Redis connection health
- Check cache hit/miss ratios
- Review cache invalidation patterns