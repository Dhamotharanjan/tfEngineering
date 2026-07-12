resource "aws_ecs_service" "service" {
  name            = "app-service"
  cluster         = "default"
  task_definition = "app-task"
}
